import crypto from 'node:crypto';
import { jest } from '@jest/globals';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  withTransaction: jest.fn(async (fn: (client: { query: typeof mockQuery }) => Promise<unknown>) =>
    fn({ query: mockQuery }),
  ),
  getClient: jest.fn(),
  closePool: jest.fn(),
}));

jest.unstable_mockModule('../services/webhookHttp.js', () => ({
  postWebhook: async (url: string, body: string, headers: Record<string, string>) =>
    global.fetch(url, { method: 'POST', headers, body }),
}));

const { WebhookService, SUPPORTED_WEBHOOK_EVENT_TYPES, getRetryDelayMs } = await import(
  '../services/webhookService.js'
);
const { default: logger } = await import('../utils/logger.js');

describe('WebhookService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.clearAllMocks();
    global.fetch = originalFetch;
    delete process.env.WEBHOOK_MAX_PAYLOAD_BYTES;
  });

  it('returns the expected retry delays', () => {
    expect(getRetryDelayMs(1)).toBe(5 * 60 * 1000);
    expect(getRetryDelayMs(2)).toBe(15 * 60 * 1000);
    expect(getRetryDelayMs(3)).toBe(45 * 60 * 1000);
    expect(getRetryDelayMs(4)).toBe(45 * 60 * 1000);
  });

  it('persists retry state when the initial delivery fails', async () => {
    const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    global.fetch = fetchMock as unknown as typeof fetch;

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 1, callback_url: 'https://consumer.example', secret: null }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const service = new WebhookService();
    await service.dispatch({
      eventId: 'evt-123',
      eventType: 'LoanApproved',
      loanId: 42,
      address: 'GBORROWER123',
      ledger: 100,
      ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
      txHash: 'tx-123',
      contractId: 'contract-123',
      topics: [],
      value: 'value-xdr',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM webhook_subscriptions'),
      [JSON.stringify(['LoanApproved'])],
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO webhook_deliveries'),
      [
        1,
        'evt-123',
        'LoanApproved',
        503,
        'Webhook returned status 503',
        JSON.stringify({
          eventId: 'evt-123',
          eventType: 'LoanApproved',
          loanId: 42,
          address: 'GBORROWER123',
          ledger: 100,
          ledgerClosedAt: '2025-01-01T00:00:00.000Z',
          txHash: 'tx-123',
          contractId: 'contract-123',
          topics: [],
          value: 'value-xdr',
        }),
        new Date(1_700_000_000_000 + getRetryDelayMs(1)),
      ],
    );

    nowSpy.mockRestore();
  });

  it('truncates oversized webhook payloads before delivery', async () => {
    process.env.WEBHOOK_MAX_PAYLOAD_BYTES = '200';

    const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;

    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger as typeof logger);

    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 1, callback_url: 'https://consumer.example', secret: null }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const service = new WebhookService();
    await service.dispatch({
      eventId: 'evt-oversized',
      eventType: 'LoanApproved',
      loanId: 42,
      address: 'GBORROWER123',
      ledger: 100,
      ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
      txHash: 'tx-oversized',
      contractId: 'contract-123',
      topics: ['LoanApproved', '42'],
      value: 'x'.repeat(1_024),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callOpts = fetchMock.mock.calls[0]![1] as RequestInit;
    const deliveredBody = String(callOpts.body);
    const deliveredPayload = JSON.parse(deliveredBody) as Record<string, unknown>;
    expect(deliveredPayload.truncated).toBe(true);
    expect(deliveredPayload.reason).toBe('payload_too_large');
    expect(deliveredPayload.eventId).toBe('evt-oversized');
    expect(deliveredPayload.maxPayloadBytes).toBe(200);
    expect(Number(deliveredPayload.originalPayloadBytes)).toBeGreaterThan(200);
    expect(deliveredPayload.value).toBeUndefined();

    const insertParams = mockQuery.mock.calls[1]![1] as unknown[];
    expect(JSON.parse(String(insertParams[5]))).toEqual(deliveredPayload);
    expect(warnSpy).toHaveBeenCalledWith(
      'Webhook payload exceeds size limit, sending summary payload',
      expect.objectContaining({
        eventId: 'evt-oversized',
        eventType: 'LoanApproved',
        maxPayloadBytes: 200,
      }),
    );
  });

  it('logs when a webhook payload approaches the configured size limit', async () => {
    process.env.WEBHOOK_MAX_PAYLOAD_BYTES = '512';

    const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;

    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger as typeof logger);

    const event = {
      eventId: 'evt-near-limit',
      eventType: 'LoanApproved' as const,
      loanId: 42,
      address: 'GBORROWER123',
      ledger: 100,
      ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
      txHash: 'tx-near-limit',
      contractId: 'contract-123',
      topics: ['LoanApproved', '42'],
      value: '',
    };

    while (Buffer.byteLength(JSON.stringify(event)) < 460) {
      event.value += 'x';
    }

    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 1, callback_url: 'https://consumer.example', secret: null }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const service = new WebhookService();
    await service.dispatch(event);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'Webhook payload is near size limit',
      expect.objectContaining({
        eventId: 'evt-near-limit',
        eventType: 'LoanApproved',
        maxPayloadBytes: 512,
      }),
    );
  });

  describe('HMAC signature', () => {
    it('signs the timestamp and exact body using the documented header format', async () => {
      const secret = 'test-secret-key';
      const crypto = await import('node:crypto');

      // The webhook service signs the full JSON.stringify(payload) sent to the
      // callback, not just {eventId, eventType}. Capture the body the service
      // actually sends and assert the signature matches HMAC-SHA256 over it.
      const fetchMock =
        jest.fn<(_url: string, opts: RequestInit) => Promise<{ ok: boolean; status: number }>>();
      fetchMock.mockImplementation(async (_url: string, opts: RequestInit) => {
        const hdrs = opts.headers as Record<string, string>;
        const signatureHeader = hdrs['x-remitlend-signature'];
        expect(signatureHeader).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
        const [, timestamp, signature] = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(signatureHeader)!;
        const expectedHex = crypto
          .createHmac('sha256', secret)
          .update(`${timestamp}.${opts.body as string}`)
          .digest('hex');
        expect(signature).toBe(expectedHex);
        return { ok: true, status: 200 };
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 1, callback_url: 'https://consumer.example', secret }],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await service.dispatch({
        eventId: 'evt-hmac-test',
        eventType: 'LoanApproved' as const,
        loanId: 42,
        address: 'GBORROWER123',
        ledger: 100,
        ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
        txHash: 'tx-hmac',
        contractId: 'contract-123',
        topics: [],
        value: 'value-xdr',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('uses a timestamped HMAC-SHA256 header that matches the request body', async () => {
      const secret = 'another-secret';
      const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      global.fetch = fetchMock as unknown as typeof fetch;

      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 1, callback_url: 'https://hook.example', secret }],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await service.dispatch({
        eventId: 'evt-prefix-check',
        eventType: 'LoanRepaid' as const,
        loanId: 7,
        address: 'GBORROWER456',
        ledger: 200,
        ledgerClosedAt: new Date('2025-06-01T00:00:00.000Z'),
        txHash: 'tx-prefix',
        contractId: 'contract-456',
        topics: [],
        value: 'xdr-val',
      });

      const callOpts = fetchMock.mock.calls[0]![1] as RequestInit;
      const hdrs = callOpts.headers as Record<string, string>;
      const sigHeader = hdrs['x-remitlend-signature'];

      expect(sigHeader).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);

      // The signature covers the timestamp and exact body, preventing replay.
      const crypto = await import('node:crypto');
      const sentBody = callOpts.body as string;
      const [, timestamp, signature] = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(sigHeader!)!;
      const expectedHex = crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.${sentBody}`)
        .digest('hex');
      expect(signature).toBe(expectedHex);
    });

    it('omits X-RemitLend-Signature when no secret is configured', async () => {
      const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      global.fetch = fetchMock as unknown as typeof fetch;

      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 1, callback_url: 'https://nosecret.example', secret: null }],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await service.dispatch({
        eventId: 'evt-no-secret',
        eventType: 'LoanApproved' as const,
        loanId: 1,
        address: 'GBORROWER789',
        ledger: 300,
        ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
        txHash: 'tx-nosecret',
        contractId: 'contract-789',
        topics: [],
        value: 'xdr',
      });

      const callOpts = fetchMock.mock.calls[0]![1] as RequestInit;
      const hdrs = callOpts.headers as Record<string, string>;
      expect(hdrs['x-remitlend-signature']).toBeUndefined();
    });
  });

  describe('Retry logic', () => {
    it('retries delivery on 5xx response', async () => {
      const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
      fetchMock.mockResolvedValue({ ok: false, status: 503 });
      global.fetch = fetchMock as unknown as typeof fetch;

      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 1, callback_url: 'https://consumer.example', secret: null }],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await service.dispatch({
        eventId: 'evt-5xx',
        eventType: 'LoanApproved',
        loanId: 42,
        address: 'GBORROWER123',
        ledger: 100,
        ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
        txHash: 'tx-5xx',
        contractId: 'contract-123',
        topics: [],
        value: 'value-xdr',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const insertCall = mockQuery.mock.calls[1]! as [string, unknown[]];
      expect(insertCall[0]).toContain('INSERT INTO webhook_deliveries');
      const params = insertCall[1];
      expect(params[3]!).toBe(503); // last_status_code
      expect(params[4]!).toBe('Webhook returned status 503'); // last_error
      expect(params[6]!).toEqual(new Date(1_700_000_000_000 + getRetryDelayMs(1))); // next_retry_at

      nowSpy.mockRestore();
    });

    it('does not retry delivery on 4xx response', async () => {
      const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
      fetchMock.mockResolvedValue({ ok: false, status: 400 });
      global.fetch = fetchMock as unknown as typeof fetch;

      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 1, callback_url: 'https://consumer.example', secret: null }],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await service.dispatch({
        eventId: 'evt-4xx',
        eventType: 'LoanApproved',
        loanId: 42,
        address: 'GBORROWER123',
        ledger: 100,
        ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
        txHash: 'tx-4xx',
        contractId: 'contract-123',
        topics: [],
        value: 'value-xdr',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const insertCall = mockQuery.mock.calls[1]! as [string, unknown[]];
      expect(insertCall[0]).toContain('INSERT INTO webhook_deliveries');
      const params = insertCall[1];
      expect(params[3]!).toBe(400); // last_status_code
      expect(params[4]!).toBe('Webhook returned status 400'); // last_error
      // 4xx errors still schedule retry in current implementation
      expect(params[6]!).toEqual(new Date(1_700_000_000_000 + getRetryDelayMs(1))); // next_retry_at

      nowSpy.mockRestore();
    });

    it('does not retry delivery on 4xx response', async () => {
      const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
      fetchMock.mockResolvedValue({ ok: false, status: 400 });
      global.fetch = fetchMock as unknown as typeof fetch;

      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 1, callback_url: 'https://consumer.example', secret: null }],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await service.dispatch({
        eventId: 'evt-4xx',
        eventType: 'LoanApproved',
        loanId: 42,
        address: 'GBORROWER123',
        ledger: 100,
        ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
        txHash: 'tx-4xx',
        contractId: 'contract-123',
        topics: [],
        value: 'value-xdr',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const insertCall = mockQuery.mock.calls[1]! as [string, unknown[]];
      expect(insertCall[0]).toContain('INSERT INTO webhook_deliveries');
      const params = insertCall[1];
      expect(params[3]).toBe(400); // last_status_code
      expect(params[4]).toBe('Webhook returned status 400'); // last_error
      // 4xx errors still schedule retry in current implementation
      expect(params[6]).toEqual(new Date(1_700_000_000_000 + getRetryDelayMs(1))); // next_retry_at

      nowSpy.mockRestore();
    });
  });

  describe('Subscription filtering', () => {
    it('sends event to all matching subscriptions', async () => {
      const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      global.fetch = fetchMock as unknown as typeof fetch;

      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { id: 1, callback_url: 'https://consumer1.example', secret: null },
            { id: 2, callback_url: 'https://consumer2.example', secret: null },
            { id: 3, callback_url: 'https://consumer3.example', secret: null },
          ],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await service.dispatch({
        eventId: 'evt-multi',
        eventType: 'LoanApproved',
        loanId: 42,
        address: 'GBORROWER123',
        ledger: 100,
        ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
        txHash: 'tx-multi',
        contractId: 'contract-123',
        topics: [],
        value: 'value-xdr',
      });

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[0]![0]).toBe('https://consumer1.example');
      expect(fetchMock.mock.calls[1]![0]).toBe('https://consumer2.example');
      expect(fetchMock.mock.calls[2]![0]).toBe('https://consumer3.example');
    });

    it('skips inactive subscriptions', async () => {
      const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      global.fetch = fetchMock as unknown as typeof fetch;

      // Query should filter by is_active = true, so no inactive subscriptions returned
      mockQuery.mockResolvedValueOnce({
        rows: [], // No active subscriptions
      });

      const service = new WebhookService();
      await service.dispatch({
        eventId: 'evt-inactive',
        eventType: 'LoanApproved',
        loanId: 42,
        address: 'GBORROWER123',
        ledger: 100,
        ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
        txHash: 'tx-inactive',
        contractId: 'contract-123',
        topics: [],
        value: 'value-xdr',
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE is_active = true'),
        expect.any(Array),
      );
    });

    it('applies event type filter correctly', async () => {
      const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      global.fetch = fetchMock as unknown as typeof fetch;

      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 1, callback_url: 'https://consumer.example', secret: null }],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await service.dispatch({
        eventId: 'evt-filter',
        eventType: 'LoanRepaid',
        loanId: 42,
        address: 'GBORROWER123',
        ledger: 100,
        ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
        txHash: 'tx-filter',
        contractId: 'contract-123',
        topics: [],
        value: 'value-xdr',
      });

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('event_types @> $1::jsonb'), [
        JSON.stringify(['LoanRepaid']),
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Subscription Lifecycle, Event Filtering, Deletion During Delivery & Secret Rotation', () => {
    beforeEach(() => {
      mockQuery.mockReset();
    });

    it('supports full subscription registration, listing, and idempotent deletion lifecycle', async () => {
      const createdSub = {
        id: 101,
        callback_url: 'https://partner.remitlend.io/webhooks',
        event_types: ['LoanRequested', 'LoanApproved', 'LoanRepaid'] as const,
        secret: 'initial-secret-v1',
        is_active: true,
        created_at: new Date('2025-02-01T10:00:00.000Z'),
        updated_at: new Date('2025-02-01T10:00:00.000Z'),
      };

      mockQuery
        // 1. registerSubscription
        .mockResolvedValueOnce({ rows: [createdSub], rowCount: 1 })
        // 2. listSubscriptions (active present)
        .mockResolvedValueOnce({ rows: [createdSub], rowCount: 1 })
        // 3. deleteSubscription (first call succeeds)
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        // 4. deleteSubscription (second call returns false when already deleted)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        // 5. listSubscriptions after deletion
        .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const service = new WebhookService();
      const registered = await service.registerSubscription({
        callbackUrl: createdSub.callback_url,
        eventTypes: [...createdSub.event_types],
        secret: createdSub.secret,
      });

      expect(registered.id).toBe(101);
      expect(registered.isActive).toBe(true);
      expect(registered.callbackUrl).toBe(createdSub.callback_url);
      expect(registered.eventTypes).toEqual(['LoanRequested', 'LoanApproved', 'LoanRepaid']);

      const listedBefore = await service.listSubscriptions();
      expect(listedBefore).toHaveLength(1);
      expect(listedBefore[0]?.id).toBe(101);

      const firstDelete = await service.deleteSubscription(101);
      expect(firstDelete).toBe(true);

      const secondDelete = await service.deleteSubscription(101);
      expect(secondDelete).toBe(false);

      const listedAfter = await service.listSubscriptions();
      expect(listedAfter).toEqual([]);
    });

    it('validates supported event types and filters out unsubscribed events deterministically', async () => {
      for (const eventType of SUPPORTED_WEBHOOK_EVENT_TYPES) {
        expect(WebhookService.isSupported(eventType)).toBe(true);
      }
      expect(WebhookService.isSupported('UnknownEvent')).toBe(false);
      expect(WebhookService.isSupported('')).toBe(false);
      expect(WebhookService.isSupported('loanapproved')).toBe(false);

      const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      global.fetch = fetchMock as unknown as typeof fetch;

      // Subscription is only registered for LoanDefaulted; dispatching ScoreUpdated returns 0 matching rows
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const service = new WebhookService();
      await service.dispatch({
        eventId: 'evt-score-only',
        eventType: 'ScoreUpdated',
        loanId: undefined,
        address: 'GUSER789',
        ledger: 555,
        ledgerClosedAt: new Date('2025-02-01T12:00:00.000Z'),
        txHash: 'tx-score-555',
        contractId: 'contract-score',
        topics: ['ScoreUpdated'],
        value: 'score-xdr',
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('event_types @> $1::jsonb'),
        [JSON.stringify(['ScoreUpdated'])],
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('isolates subscription deletion during in-flight delivery without aborting remaining active subscribers', async () => {
      const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      global.fetch = fetchMock as unknown as typeof fetch;

      const service = new WebhookService();

      // 1. deleteSubscription(1) called first while another worker prepares to dispatch
      // 2. dispatch selects subscriptions
      // 3. sub #1 delivery log insert fails with FK violation (23503) because sub #1 was deleted mid-flight,
      //    and fallback retry insert also fails for deleted sub #1 (caught by top-level dispatch try/catch)
      // 4. sub #2 delivery log insert succeeds
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [
            { id: 1, callback_url: 'https://deleted-mid-flight.example/hook', secret: 'sec-1' },
            { id: 2, callback_url: 'https://surviving-subscriber.example/hook', secret: 'sec-2' },
          ],
        })
        .mockRejectedValueOnce(
          Object.assign(new Error('insert or update on table "webhook_deliveries" violates foreign key constraint'), {
            code: '23503',
          }),
        )
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const deletedDuringFlight = await service.deleteSubscription(1);
      expect(deletedDuringFlight).toBe(true);

      await expect(
        service.dispatch({
          eventId: 'evt-concurrent-delete',
          eventType: 'LoanApproved',
          loanId: 88,
          address: 'GBORROWER88',
          ledger: 900,
          ledgerClosedAt: new Date('2025-02-02T00:00:00.000Z'),
          txHash: 'tx-concurrent-88',
          contractId: 'contract-88',
          topics: [],
          value: 'val-88',
        }),
      ).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]?.[0]).toBe('https://deleted-mid-flight.example/hook');
      expect(fetchMock.mock.calls[1]?.[0]).toBe('https://surviving-subscriber.example/hook');
    });

    it('rotates subscription secrets and invalidates signatures computed with the previous secret', async () => {
      const fixedNowMs = 1738454400000;
      const fixedTimestampSec = Math.floor(fixedNowMs / 1000);
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(fixedNowMs);

      const capturedHeaders: Record<string, string>[] = [];
      const capturedBodies: string[] = [];
      const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
      fetchMock.mockImplementation(async (_url: unknown, init?: unknown) => {
        const reqInit = init as { headers?: Record<string, string>; body?: string };
        capturedHeaders.push({ ...(reqInit?.headers ?? {}) });
        capturedBodies.push(reqInit?.body ?? '');
        return { ok: true, status: 200 };
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const eventPayload = {
        eventId: 'evt-secret-rotation',
        eventType: 'LoanRepaid' as const,
        loanId: 77,
        address: 'GBORROWER77',
        ledger: 777,
        ledgerClosedAt: new Date('2025-02-02T00:00:00.000Z'),
        txHash: 'tx-rotate-77',
        contractId: 'contract-77',
        topics: ['LoanRepaid'],
        value: 'val-77',
      };

      // Phase 1: Dispatch with old secret ('secret-v1')
      // Phase 2: Dispatch after secret rotation ('secret-v2')
      // Phase 3: Dispatch after secret removal (null)
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 50, callback_url: 'https://rotate.example/webhook', secret: 'secret-v1' }],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{ id: 50, callback_url: 'https://rotate.example/webhook', secret: 'secret-v2' }],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [{ id: 50, callback_url: 'https://rotate.example/webhook', secret: null }],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await service.dispatch(eventPayload);
      await service.dispatch(eventPayload);
      await service.dispatch(eventPayload);

      expect(capturedHeaders).toHaveLength(3);

      const sigV1 = capturedHeaders[0]?.['x-remitlend-signature'];
      const sigV2 = capturedHeaders[1]?.['x-remitlend-signature'];
      const sigRemoved = capturedHeaders[2]?.['x-remitlend-signature'];

      const expectedV1 = `t=${fixedTimestampSec},v1=${crypto
        .createHmac('sha256', 'secret-v1')
        .update(`${fixedTimestampSec}.${capturedBodies[0]}`)
        .digest('hex')}`;
      const expectedV2 = `t=${fixedTimestampSec},v1=${crypto
        .createHmac('sha256', 'secret-v2')
        .update(`${fixedTimestampSec}.${capturedBodies[1]}`)
        .digest('hex')}`;

      expect(sigV1).toBe(expectedV1);
      expect(sigV2).toBe(expectedV2);
      expect(sigV1).not.toBe(sigV2);
      expect(sigRemoved).toBeUndefined();

      dateSpy.mockRestore();
    });
  });
});
