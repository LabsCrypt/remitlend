import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import crypto from 'node:crypto';

type MockQueryResult = { rows: unknown[]; rowCount?: number };
type MockQuery = (text: string, params?: unknown[]) => Promise<MockQueryResult>;

const mockQuery = jest.fn<MockQuery>();

jest.unstable_mockModule('../db/connection.js', () => ({
  withAdvisoryLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  default: { query: mockQuery },
  query: mockQuery,
  withTransaction: jest.fn(async (fn: (client: { query: MockQuery }) => Promise<unknown>) =>
    fn({ query: mockQuery }),
  ),
  getClient: jest.fn(),
  closePool: jest.fn(),
}));

jest.unstable_mockModule('../services/webhookHttp.js', () => ({
  postWebhook: async (url: string, body: string, headers: Record<string, string>) =>
    global.fetch(url, { method: 'POST', headers, body }),
}));

const { WebhookService } = await import('../services/webhookService.js');
const { decryptWebhookSecret, encryptWebhookSecret } = await import('../utils/webhookSecret.js');

const SECRET_KEY = 'test-webhook-secret-encryption-key';

const buildEvent = (overrides: Record<string, unknown> = {}) => {
  return {
    eventId: 'evt-lifecycle',
    eventType: 'LoanApproved' as const,
    loanId: 42,
    address: 'GBORROWER123',
    ledger: 100,
    ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
    txHash: 'tx-lifecycle',
    contractId: 'contract-123',
    topics: [],
    value: 'value-xdr',
    ...overrides,
  };
};

const subscriptionRow = (overrides: Record<string, unknown> = {}) => {
  return {
    id: 1,
    callback_url: 'https://consumer.example',
    event_types: ['LoanApproved'],
    is_active: true,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-02T00:00:00.000Z',
    ...overrides,
  };
};

const hmacFor = (secret: string, body: string, signatureHeader: string): string => {
  const [, timestamp] = /^t=(\d+),v1=[a-f0-9]{64}$/.exec(signatureHeader)!;
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
};

describe('webhook subscription lifecycle', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReset();
    process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = SECRET_KEY;
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  });

  describe('registration', () => {
    it('stores the secret encrypted at rest and never returns it', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [subscriptionRow({ event_types: ['LoanApproved', 'LoanRepaid'] })],
        rowCount: 1,
      });

      const service = new WebhookService();
      const subscription = await service.registerSubscription({
        callbackUrl: 'https://consumer.example',
        eventTypes: ['LoanApproved', 'LoanRepaid'],
        secret: 'super-secret',
      });

      const params = mockQuery.mock.calls[0]![1] as unknown[];
      const storedSecret = String(params[2]);
      expect(storedSecret.startsWith('enc:v1:')).toBe(true);
      expect(storedSecret).not.toContain('super-secret');
      expect(decryptWebhookSecret(storedSecret)).toBe('super-secret');
      expect(subscription).not.toHaveProperty('secret');
      expect(subscription.eventTypes).toEqual(['LoanApproved', 'LoanRepaid']);
    });

    it('registers a subscription without a secret as a null column', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [subscriptionRow({ event_types: ['LoanRepaid'] })],
        rowCount: 1,
      });

      const service = new WebhookService();
      await service.registerSubscription({
        callbackUrl: 'https://consumer.example',
        eventTypes: ['LoanRepaid'],
      });

      const params = mockQuery.mock.calls[0]![1] as unknown[];
      expect(params[2]).toBeNull();
    });

    it('persists the full event filter list as JSON', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [subscriptionRow()], rowCount: 1 });

      const service = new WebhookService();
      await service.registerSubscription({
        callbackUrl: 'https://consumer.example',
        eventTypes: ['LoanApproved', 'LoanRepaid', 'LoanDefaulted'],
      });

      const params = mockQuery.mock.calls[0]![1] as unknown[];
      expect(JSON.parse(String(params[1]))).toEqual([
        'LoanApproved',
        'LoanRepaid',
        'LoanDefaulted',
      ]);
    });
  });

  describe('listing and deletion', () => {
    it('maps subscription rows including inactive ones', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [subscriptionRow({ id: 7, is_active: false })],
        rowCount: 1,
      });

      const service = new WebhookService();
      const subscriptions = await service.listSubscriptions();

      expect(subscriptions).toEqual([
        {
          id: 7,
          callbackUrl: 'https://consumer.example',
          eventTypes: ['LoanApproved'],
          isActive: false,
          createdAt: new Date('2025-01-01T00:00:00.000Z'),
          updatedAt: new Date('2025-01-02T00:00:00.000Z'),
        },
      ]);
    });

    it('reports true when the subscription existed', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await expect(service.deleteSubscription(7)).resolves.toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM webhook_subscriptions'),
        [7],
      );
    });

    it('reports false when the subscription was already deleted', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const service = new WebhookService();
      await expect(service.deleteSubscription(7)).resolves.toBe(false);
    });
  });

  describe('event filtering during dispatch', () => {
    it('queries only active subscriptions for the exact event type', async () => {
      global.fetch = jest
        .fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>()
        .mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;
      mockQuery
        .mockResolvedValueOnce({ rows: [subscriptionRow()], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await service.dispatch(buildEvent({ eventType: 'LoanRepaid' }));

      expect(mockQuery).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('WHERE is_active = true'),
        [JSON.stringify(['LoanRepaid'])],
      );
    });

    it('does not call any subscriber when the event type matches nothing', async () => {
      const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
      global.fetch = fetchMock as unknown as typeof fetch;
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const service = new WebhookService();
      await service.dispatch(buildEvent());

      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('deletion during delivery', () => {
    it('isolates a subscription deleted mid-delivery from the remaining subscribers', async () => {
      const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      global.fetch = fetchMock as unknown as typeof fetch;

      const persistedDeliveredIds: number[] = [];
      mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM webhook_subscriptions')) {
          return {
            rows: [
              subscriptionRow({ id: 1, callback_url: 'https://deleted.example' }),
              subscriptionRow({ id: 2, callback_url: 'https://alive.example' }),
            ],
            rowCount: 2,
          };
        }
        // The subscription was deleted between selection and delivery, so the
        // delivered row cannot be written for it.
        if (sql.includes('INSERT INTO webhook_deliveries') && params?.[0] === 1) {
          const err = new Error(
            'insert or update on table "webhook_deliveries" violates foreign key constraint',
          ) as Error & { code: string };
          err.code = '23503';
          throw err;
        }
        if (sql.includes('delivered_at')) {
          persistedDeliveredIds.push(Number(params![0]));
        }
        return { rows: [], rowCount: 1 };
      });

      const service = new WebhookService();
      await expect(service.dispatch(buildEvent())).resolves.toBeUndefined();

      // The surviving subscriber still received and recorded its delivery.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(persistedDeliveredIds).toEqual([2]);
    });
  });

  describe('secret rotation', () => {
    it('writes a distinct ciphertext each time the same secret is rotated', () => {
      const first = encryptWebhookSecret('same-secret');
      const second = encryptWebhookSecret('same-secret');

      expect(first).not.toBe(second);
      expect(decryptWebhookSecret(first)).toBe('same-secret');
      expect(decryptWebhookSecret(second)).toBe('same-secret');
    });

    it('signs deliveries with the rotated secret and never the previous one', async () => {
      const oldSecret = 'old-secret';
      const rotatedSecret = 'rotated-secret';
      let deliveredSignature = '';

      global.fetch = jest.fn(async (_url: string, opts: RequestInit) => {
        const headers = opts.headers as Record<string, string>;
        deliveredSignature = headers['x-remitlend-signature']!;
        return { ok: true, status: 200 };
      }) as unknown as typeof fetch;

      mockQuery
        .mockResolvedValueOnce({
          rows: [subscriptionRow({ secret: encryptWebhookSecret(rotatedSecret) })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await service.dispatch(buildEvent());

      const body = JSON.stringify({
        eventId: 'evt-lifecycle',
        eventType: 'LoanApproved',
        loanId: 42,
        address: 'GBORROWER123',
        ledger: 100,
        ledgerClosedAt: '2025-01-01T00:00:00.000Z',
        txHash: 'tx-lifecycle',
        contractId: 'contract-123',
        topics: [],
        value: 'value-xdr',
      });
      expect(deliveredSignature).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
      expect(hmacFor(rotatedSecret, body, deliveredSignature)).toBe(
        /^t=\d+,v1=([a-f0-9]{64})$/.exec(deliveredSignature)![1],
      );
      expect(hmacFor(oldSecret, body, deliveredSignature)).not.toBe(
        /^t=\d+,v1=([a-f0-9]{64})$/.exec(deliveredSignature)![1],
      );
    });

    it('keeps legacy plaintext secrets usable during rotation', async () => {
      const plaintextSecret = 'legacy-plaintext-secret';
      let deliveredSignature = '';

      global.fetch = jest.fn(async (_url: string, opts: RequestInit) => {
        deliveredSignature = (opts.headers as Record<string, string>)['x-remitlend-signature']!;
        return { ok: true, status: 200 };
      }) as unknown as typeof fetch;

      mockQuery
        .mockResolvedValueOnce({
          rows: [subscriptionRow({ secret: plaintextSecret })],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await service.dispatch(buildEvent());

      const body = JSON.stringify({
        eventId: 'evt-lifecycle',
        eventType: 'LoanApproved',
        loanId: 42,
        address: 'GBORROWER123',
        ledger: 100,
        ledgerClosedAt: '2025-01-01T00:00:00.000Z',
        txHash: 'tx-lifecycle',
        contractId: 'contract-123',
        topics: [],
        value: 'value-xdr',
      });
      expect(hmacFor(plaintextSecret, body, deliveredSignature)).toBe(
        /^t=\d+,v1=([a-f0-9]{64})$/.exec(deliveredSignature)![1],
      );
    });
  });
});
