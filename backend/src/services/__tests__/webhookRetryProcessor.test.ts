import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

type MockQueryResult = { rows: unknown[]; rowCount?: number };
type TransactionCallback = (client: { query: typeof mockQuery }) => Promise<unknown>;

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();
const mockWithTransaction: jest.MockedFunction<(fn: TransactionCallback) => Promise<unknown>> =
  jest.fn(async (fn) => fn({ query: mockQuery }));

jest.unstable_mockModule('../../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  withTransaction: mockWithTransaction,
  getClient: jest.fn(),
  closePool: jest.fn(),
}));

jest.unstable_mockModule('../../middleware/metrics.js', () => ({
  refreshWebhookRetryQueueDepth: jest.fn(),
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    withContext: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

jest.unstable_mockModule('../jobMetricsService.js', () => ({
  jobMetricsService: {
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
  },
}));

jest.unstable_mockModule('../webhookHttp.js', () => ({
  postWebhook: async (url: string, body: string, headers: Record<string, string>) =>
    global.fetch(url, { method: 'POST', headers, body }),
}));

const { WebhookService, getRetryDelayMs } = await import('../webhookService.js');
const { startWebhookRetryProcessor, stopWebhookRetryProcessor } =
  await import('../webhookRetryProcessor.js');

const MAX_RETRY_ATTEMPTS = 4;

function deliveryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    subscription_id: 1,
    callback_url: 'https://hook.example.com/callback',
    secret: null,
    event_id: 'evt-001',
    event_type: 'LoanApproved',
    payload: { eventId: 'evt-001', eventType: 'LoanApproved', loanId: 42 },
    attempt_count: 0,
    ...overrides,
  };
}

function queueRetryBatch(rows: unknown[], outcomeCount = rows.length): void {
  mockQuery.mockResolvedValueOnce({ rows });
  if (rows.length > 0) {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: rows.length });
    for (let index = 0; index < outcomeCount; index++) {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    }
  }
}

describe('WebhookRetryProcessor', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWithTransaction.mockImplementation(async (fn) => fn({ query: mockQuery }));
    global.fetch = originalFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('processRetries', () => {
    it('handles no pending deliveries gracefully', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await WebhookService.processRetries();

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('FOR UPDATE OF wd SKIP LOCKED'),
        expect.any(Array),
      );
      expect(mockQuery.mock.calls[0]?.[0]).toContain('wd.delivered_at IS NULL');
      expect(mockQuery.mock.calls[0]?.[0]).toContain('wd.next_retry_at <= $1');
      expect(mockQuery.mock.calls[0]?.[0]).toContain('wd.attempt_count < $2');
    });

    it('retries a pending delivery successfully', async () => {
      const fetchMock = jest.fn(async () => ({
        ok: true,
        status: 200,
      })) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      const row = deliveryRow({ attempt_count: 1 });
      queueRetryBatch([row]);

      await WebhookService.processRetries();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://hook.example.com/callback',
        expect.objectContaining({ method: 'POST' }),
      );

      const claimCall = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(claimCall[0]).toContain('SET next_retry_at = $1');
      expect(claimCall[1]?.[2]).toEqual([row.id]);
      const updateCall = mockQuery.mock.calls[2] as [string, unknown[]];
      expect(updateCall[0]).toContain('UPDATE webhook_deliveries');
      expect(updateCall[1]?.[0]).toBe(2); // attempt_count = 1 + 1
      expect(updateCall[1]?.[1]).toBe(200); // last_status_code
      expect(updateCall[1]?.[2]).toBeInstanceOf(Date); // delivered_at
    });

    it('schedules backoff retry on failure', async () => {
      const fetchMock = jest.fn(async () => ({
        ok: false,
        status: 503,
      })) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      const row = deliveryRow({ attempt_count: 0 });
      const now = 1_700_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);

      queueRetryBatch([row]);

      await WebhookService.processRetries();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const updateCall = mockQuery.mock.calls[2] as [string, unknown[]];
      expect(updateCall[0]).toContain('UPDATE webhook_deliveries');
      expect(updateCall[1]?.[0]).toBe(1); // attempt_count
      expect(updateCall[1]?.[1]).toBe(503); // last_status_code
      expect(updateCall[1]?.[2]).toBe('Webhook returned status 503');
      expect(updateCall[1]?.[3]).toEqual(new Date(now + getRetryDelayMs(1))); // next_retry_at
    });

    it('does not dispatch a claimed delivery from another worker before the first HTTP completes', async () => {
      const row = deliveryRow({ attempt_count: 1 });
      const timeline: string[] = [];
      let claimed = false;
      let httpStarted: (() => void) | undefined;
      let finishHttp: ((response: { ok: boolean; status: number }) => void) | undefined;
      const httpStartedPromise = new Promise<void>((resolve) => {
        httpStarted = resolve;
      });

      global.fetch = jest.fn(
        () =>
          new Promise((resolve) => {
            timeline.push('http');
            httpStarted?.();
            finishHttp = resolve;
          }),
      ) as unknown as typeof fetch;

      mockWithTransaction.mockImplementation(async (fn) => {
        let pendingClaim = false;
        const txQuery: typeof mockQuery = jest.fn(async (text, params) => {
          if (text.includes('SELECT wd.id')) {
            timeline.push('select');
            return { rows: claimed ? [] : [row] };
          }
          if (text.includes('UPDATE webhook_deliveries')) {
            timeline.push('claim');
            expect(params?.[0]).toBeInstanceOf(Date);
            pendingClaim = true;
            return { rows: [], rowCount: 1 };
          }
          return { rows: [] };
        });
        const result = await fn({ query: txQuery });
        if (pendingClaim) {
          claimed = true;
          timeline.push('commit');
        }
        return result;
      });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const workerA = WebhookService.processRetries();
      await httpStartedPromise;
      await WebhookService.processRetries();

      expect(timeline.slice(0, 3)).toEqual(['select', 'claim', 'commit']);
      expect(timeline[3]).toBe('http');
      expect(timeline.filter((event) => event === 'select')).toHaveLength(2);
      expect(timeline.filter((event) => event === 'claim')).toHaveLength(1);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      finishHttp?.({ ok: true, status: 200 });
      await workerA;
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('allows a second worker to claim a different row while the first row is locked', async () => {
      const firstRow = deliveryRow({ id: 1, attempt_count: 1 });
      const secondRow = deliveryRow({
        id: 2,
        attempt_count: 1,
        callback_url: 'https://other.example.com/callback',
      });
      const lockedIds = new Set<number>();
      const queries: string[] = [];
      let releaseFirstSelect: (() => void) | undefined;
      let firstSelectEntered: (() => void) | undefined;
      const firstSelectPromise = new Promise<void>((resolve) => {
        firstSelectEntered = resolve;
      });
      const firstSelectGate = new Promise<void>((resolve) => {
        releaseFirstSelect = resolve;
      });
      let transactionCount = 0;
      global.fetch = jest.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;

      mockWithTransaction.mockImplementation(async (fn) => {
        const workerId = ++transactionCount;
        let claimedIds: number[] = [];
        const txQuery: typeof mockQuery = jest.fn(async (text, params) => {
          queries.push(text);
          if (text.includes('SELECT wd.id')) {
            if (workerId === 1) {
              lockedIds.add(firstRow.id);
              firstSelectEntered?.();
              await firstSelectGate;
              return { rows: [firstRow] };
            }
            return { rows: lockedIds.has(firstRow.id) ? [secondRow] : [firstRow] };
          }
          if (text.includes('UPDATE webhook_deliveries')) {
            claimedIds = params?.[2] as number[];
            return { rows: [], rowCount: claimedIds.length };
          }
          return { rows: [] };
        });
        const result = await fn({ query: txQuery });
        for (const id of claimedIds) lockedIds.add(id);
        return result;
      });
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

      const workerA = WebhookService.processRetries();
      await firstSelectPromise;
      await WebhookService.processRetries();
      expect(global.fetch).toHaveBeenCalledWith(
        secondRow.callback_url,
        expect.objectContaining({ method: 'POST' }),
      );

      releaseFirstSelect?.();
      await workerA;
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(
        queries
          .filter((text) => text.includes('SELECT wd.id'))
          .every((text) => text.includes('FOR UPDATE OF wd SKIP LOCKED')),
      ).toBe(true);
    });

    it('makes a claimed delivery eligible again after its lease expires', async () => {
      const circularPayload: Record<string, unknown> = {};
      circularPayload.self = circularPayload;
      const row = deliveryRow({ payload: circularPayload });
      const selectedLeaseDates: Date[] = [];
      let leaseUntil: Date | undefined;
      const fetchMock = jest.fn() as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;
      jest.useFakeTimers().setSystemTime(new Date('2026-09-29T00:00:00.000Z'));

      mockWithTransaction.mockImplementation(async (fn) => {
        let pendingLease: Date | undefined;
        const txQuery: typeof mockQuery = jest.fn(async (text, params) => {
          if (text.includes('SELECT wd.id')) {
            const now = params?.[0] as Date;
            selectedLeaseDates.push(now);
            return { rows: !leaseUntil || leaseUntil <= now ? [row] : [] };
          }
          if (text.includes('UPDATE webhook_deliveries')) {
            pendingLease = params?.[0] as Date;
            return { rows: [], rowCount: 1 };
          }
          return { rows: [] };
        });
        const result = await fn({ query: txQuery });
        if (pendingLease) leaseUntil = pendingLease;
        return result;
      });

      try {
        await WebhookService.processRetries();
        expect(leaseUntil).toBeInstanceOf(Date);
        jest.setSystemTime(new Date(leaseUntil!.getTime() + 1));
        await WebhookService.processRetries();

        expect(selectedLeaseDates).toHaveLength(2);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('sets next_retry_at with progressive backoff on multiple failures', async () => {
      const fetchMock = jest.fn(async () => ({
        ok: false,
        status: 500,
      })) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      const now = 1_700_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const row = deliveryRow({ attempt_count: 2 });
      queueRetryBatch([row]);

      await WebhookService.processRetries();

      const updateCall = mockQuery.mock.calls[2] as [string, unknown[]];
      expect(updateCall[1]?.[0]).toBe(3); // attempt_count = 2 + 1
      expect(updateCall[1]?.[3]).toEqual(new Date(now + getRetryDelayMs(3)));

      // Backoff should increase with each attempt
      expect(getRetryDelayMs(1)).toBe(5 * 60 * 1000);
      expect(getRetryDelayMs(2)).toBe(15 * 60 * 1000);
      expect(getRetryDelayMs(3)).toBe(45 * 60 * 1000);
    });
  });

  describe('circuit-breaker behavior (max attempts)', () => {
    it('permanently fails delivery after max retry attempts', async () => {
      const fetchMock = jest.fn(async () => ({
        ok: false,
        status: 500,
      })) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      const now = 1_700_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);

      // attempt_count = MAX_RETRY_ATTEMPTS - 1 means next attempt will hit the limit
      const row = deliveryRow({ attempt_count: MAX_RETRY_ATTEMPTS - 1 });
      queueRetryBatch([row]);

      await WebhookService.processRetries();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const updateCall = mockQuery.mock.calls[2] as [string, unknown[]];
      expect(updateCall[1]?.[0]).toBe(MAX_RETRY_ATTEMPTS); // attempt_count = MAX
      expect(updateCall[1]?.[1]).toBe(500); // last_status_code
      // next_retry_at should be null (permanently failed)
      expect(updateCall[1]?.[3]).toBeNull();
    });

    it('does not pick up deliveries at max attempts (circuit open)', async () => {
      const fetchMock = jest.fn(async () => ({
        ok: true,
        status: 200,
      })) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      // attempt_count >= MAX_RETRY_ATTEMPTS should be filtered out by the query
      queueRetryBatch([]);

      await WebhookService.processRetries();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockQuery.mock.calls[0]?.[0]).toContain('wd.attempt_count < $2');
    });
  });

  describe('subscriber isolation', () => {
    it('processes remaining deliveries when one delivery fails', async () => {
      let callCount = 0;
      const fetchMock = jest.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return { ok: false, status: 500 };
        }
        return { ok: true, status: 200 };
      }) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      const row1 = deliveryRow({
        id: 1,
        subscription_id: 1,
        callback_url: 'https://degraded.example.com/callback',
        attempt_count: 1,
      });
      const row2 = deliveryRow({
        id: 2,
        subscription_id: 2,
        callback_url: 'https://healthy.example.com/callback',
        attempt_count: 1,
      });

      const now = 1_700_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);

      queueRetryBatch([row1, row2], 2);

      await WebhookService.processRetries();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]?.[0]).toBe('https://degraded.example.com/callback');
      expect(fetchMock.mock.calls[1]?.[0]).toBe('https://healthy.example.com/callback');

      // Both deliveries should have been processed (one failed, one succeeded)
      expect(mockQuery).toHaveBeenCalledTimes(4);
      const updateCalls = mockQuery.mock.calls.filter(
        (call) =>
          (call[0] as string).includes('UPDATE webhook_deliveries') &&
          (call[0] as string).includes('SET attempt_count'),
      );
      expect(updateCalls).toHaveLength(2);
    });

    it('continues processing other deliveries even after a network error on one', async () => {
      let callCount = 0;
      const fetchMock = jest.fn(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Network timeout');
        }
        return { ok: true, status: 200 };
      }) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      const row1 = deliveryRow({
        id: 1,
        subscription_id: 1,
        callback_url: 'https://failing.example.com/callback',
        attempt_count: 0,
      });
      const row2 = deliveryRow({
        id: 2,
        subscription_id: 2,
        callback_url: 'https://good.example.com/callback',
        attempt_count: 0,
      });

      const now = 1_700_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);

      queueRetryBatch([row1, row2], 2);

      await WebhookService.processRetries();

      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Both deliveries should have been updated in DB
      const updateCalls = mockQuery.mock.calls.filter(
        (call) =>
          (call[0] as string).includes('UPDATE webhook_deliveries') &&
          (call[0] as string).includes('SET attempt_count'),
      );
      expect(updateCalls).toHaveLength(2);
    });
  });

  describe('overlap guard (in-flight)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      stopWebhookRetryProcessor();
      jest.useRealTimers();
    });

    it('skips a tick when the previous run is still in-flight', async () => {
      // First call resolves slowly
      const firstCallResolvers: Array<() => void> = [];
      const slowQuery: jest.MockedFunction<
        (text: string, params?: unknown[]) => Promise<MockQueryResult>
      > = jest.fn(async () => {
        return new Promise<MockQueryResult>((resolve) => {
          firstCallResolvers.push(() => resolve({ rows: [] }));
        });
      });

      // Replace the mocked query used by processRetries
      // The mock is hoisted, so we override the shared mockQuery's implementation
      mockQuery.mockImplementation(slowQuery);

      // Mock refreshWebhookRetryQueueDepth to succeed immediately
      const { refreshWebhookRetryQueueDepth } = (await import('../../middleware/metrics.js')) as {
        refreshWebhookRetryQueueDepth: jest.Mock;
      };
      refreshWebhookRetryQueueDepth.mockResolvedValue(undefined);

      startWebhookRetryProcessor();

      // Trigger first tick — starts processRetries which is awaiting
      await jest.advanceTimersByTimeAsync(10_000);

      // processRetries is now in-flight; trigger second tick
      await jest.advanceTimersByTimeAsync(10_000);

      // processRetries should have been called exactly once
      expect(slowQuery).toHaveBeenCalledTimes(1);

      // Resolve the in-flight call
      firstCallResolvers[0]!();
      // Flush any pending microtasks
      await jest.advanceTimersByTimeAsync(0);

      // Now a subsequent tick should be able to run
      mockQuery.mockReset();
      mockQuery.mockResolvedValue({ rows: [] });
      await jest.advanceTimersByTimeAsync(10_000);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('does not send duplicate deliveries when two ticks overlap', async () => {
      const row = deliveryRow({ attempt_count: 1 });
      const fetchMock = jest.fn(async () => ({
        ok: true,
        status: 200,
      })) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      let resolveFirst: (() => void) | null = null;
      let callCount = 0;

      mockQuery.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First SELECT returns a row but hangs before processing completes
          return new Promise<MockQueryResult>((resolve) => {
            resolveFirst = () => resolve({ rows: [row] });
          });
        }
        // Subsequent calls (second tick would be blocked, but if it weren't...)
        return { rows: [] };
      });

      const { refreshWebhookRetryQueueDepth } = (await import('../../middleware/metrics.js')) as {
        refreshWebhookRetryQueueDepth: jest.Mock;
      };
      refreshWebhookRetryQueueDepth.mockResolvedValue(undefined);

      startWebhookRetryProcessor();

      // Trigger first tick
      await jest.advanceTimersByTimeAsync(10_000);

      // Trigger second tick — should be blocked by inFlight
      await jest.advanceTimersByTimeAsync(10_000);

      // fetch should NOT have been called yet (first tick is still pending)
      expect(fetchMock).not.toHaveBeenCalled();

      // Resolve the first tick
      resolveFirst!();
      await jest.advanceTimersByTimeAsync(0);

      // Now fetch was called exactly once for the delivery
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('retryWebhookDelivery edge cases', () => {
    it('handles network timeout errors gracefully', async () => {
      const fetchMock = jest.fn(async () => {
        throw new Error('fetch failed');
      }) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      const now = 1_700_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);

      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await WebhookService.retryWebhookDelivery(
        1,
        1,
        'https://hook.example.com/callback',
        undefined,
        'evt-001',
        'LoanApproved',
        { eventId: 'evt-001' },
        0,
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const updateCall = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(updateCall[0]).toContain('UPDATE webhook_deliveries');
      expect(updateCall[1]?.[0]).toBe(1); // attempt_count
      expect(updateCall[1]?.[1]).toBe('fetch failed'); // last_error
      expect(updateCall[1]?.[2]).toEqual(new Date(now + getRetryDelayMs(1))); // next_retry_at
    });
  });
});
