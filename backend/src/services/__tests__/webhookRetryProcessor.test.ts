import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();
const mockLoggerError = jest.fn<(message: string, meta?: unknown) => void>();

jest.unstable_mockModule('../../db/connection.js', () => ({
  withAdvisoryLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  default: { query: mockQuery },
  query: mockQuery,
  withTransaction: jest.fn(async (fn: (client: { query: typeof mockQuery }) => Promise<unknown>) =>
    fn({ query: mockQuery }),
  ),
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
      error: mockLoggerError,
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

describe('WebhookRetryProcessor', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReset();
    global.fetch = originalFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
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
    });

    it('retries a pending delivery successfully', async () => {
      const fetchMock = jest.fn(async () => ({
        ok: true,
        status: 200,
      })) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      const row = deliveryRow({ attempt_count: 1 });
      mockQuery
        .mockResolvedValueOnce({ rows: [row] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await WebhookService.processRetries();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://hook.example.com/callback',
        expect.objectContaining({ method: 'POST' }),
      );

      const updateCall = mockQuery.mock.calls[1] as [string, unknown[]];
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

      mockQuery
        .mockResolvedValueOnce({ rows: [row] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await WebhookService.processRetries();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const updateCall = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(updateCall[0]).toContain('UPDATE webhook_deliveries');
      expect(updateCall[1]?.[0]).toBe(1); // attempt_count
      expect(updateCall[1]?.[1]).toBe(503); // last_status_code
      expect(updateCall[1]?.[2]).toBe('Webhook returned status 503');
      expect(updateCall[1]?.[3]).toEqual(new Date(now + getRetryDelayMs(1))); // next_retry_at
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
      mockQuery
        .mockResolvedValueOnce({ rows: [row] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await WebhookService.processRetries();

      const updateCall = mockQuery.mock.calls[1] as [string, unknown[]];
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
      mockQuery
        .mockResolvedValueOnce({ rows: [row] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await WebhookService.processRetries();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const updateCall = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(updateCall[1]).toEqual([
        MAX_RETRY_ATTEMPTS,
        500,
        'Webhook returned status 500',
        null,
        expect.any(Date),
        1,
      ]);
      // A dead-letter row is never marked delivered.
      expect(updateCall[0]).not.toContain('delivered_at');
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Webhook delivery permanently failed after max retries',
        expect.objectContaining({
          deliveryId: 1,
          attemptCount: MAX_RETRY_ATTEMPTS,
          statusCode: 500,
        }),
      );
    });

    it('does not pick up deliveries at max attempts (circuit open)', async () => {
      const fetchMock = jest.fn(async () => ({
        ok: true,
        status: 200,
      })) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      // attempt_count >= MAX_RETRY_ATTEMPTS should be filtered out by the query
      mockQuery.mockResolvedValueOnce({
        rows: [deliveryRow({ attempt_count: MAX_RETRY_ATTEMPTS })],
      });

      await WebhookService.processRetries();

      expect(fetchMock).not.toHaveBeenCalled();
      // The dead-letter row is left untouched by the retry processor.
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('dead-letter persistence and replay', () => {
    it('persists a dead-letter row after a final network error without a status code', async () => {
      const fetchMock = jest.fn(async () => {
        throw new Error('DNS lookup failed');
      }) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      mockQuery
        .mockResolvedValueOnce({
          rows: [deliveryRow({ attempt_count: MAX_RETRY_ATTEMPTS - 1 })],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await WebhookService.processRetries();

      const updateCall = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(updateCall[0]).toContain('UPDATE webhook_deliveries');
      expect(updateCall[1]).toEqual([
        MAX_RETRY_ATTEMPTS,
        'DNS lookup failed',
        null,
        expect.any(Date),
        1,
      ]);
      expect(updateCall[0]).not.toContain('delivered_at');
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Webhook delivery permanently failed after max retries',
        expect.objectContaining({ deliveryId: 1, attemptCount: MAX_RETRY_ATTEMPTS }),
      );
    });

    it('replays a dead-letter delivery after it is re-queued and marks it delivered', async () => {
      let callCount = 0;
      const fetchMock = jest.fn(async () => {
        callCount += 1;
        return callCount === 1 ? { ok: false, status: 503 } : { ok: true, status: 200 };
      }) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      const now = 1_700_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);
      const deadLetterId = 77;

      mockQuery
        .mockResolvedValueOnce({
          rows: [
            deliveryRow({
              id: deadLetterId,
              attempt_count: MAX_RETRY_ATTEMPTS - 1,
              callback_url: 'https://dead.example/callback',
            }),
          ],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: [
            deliveryRow({
              id: deadLetterId,
              attempt_count: 0,
              callback_url: 'https://replayed.example/callback',
            }),
          ],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await WebhookService.processRetries();
      await WebhookService.processRetries();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]?.[0]).toBe('https://dead.example/callback');
      expect(fetchMock.mock.calls[1]?.[0]).toBe('https://replayed.example/callback');

      const updateCalls = mockQuery.mock.calls.filter((call) =>
        (call[0] as string).includes('UPDATE webhook_deliveries'),
      ) as Array<[string, unknown[]]>;
      expect(updateCalls).toHaveLength(2);
      expect(updateCalls[0]![1]).toEqual([
        MAX_RETRY_ATTEMPTS,
        503,
        'Webhook returned status 503',
        null,
        expect.any(Date),
        deadLetterId,
      ]);
      expect(updateCalls[1]![1]).toEqual([
        1,
        200,
        expect.any(Date),
        expect.any(Date),
        deadLetterId,
      ]);
      expect(updateCalls[1]![0]).toContain('delivered_at = $3');
      expect(updateCalls[1]![0]).toContain('last_error = NULL');
      expect(updateCalls[1]![0]).toContain('next_retry_at = NULL');
    });

    it('allows an explicit replay of a dead-letter delivery to succeed', async () => {
      const fetchMock = jest.fn(async () => ({
        ok: true,
        status: 200,
      })) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await WebhookService.retryWebhookDelivery(
        88,
        1,
        'https://explicit-replay.example/callback',
        undefined,
        'evt-replay',
        'LoanApproved',
        { eventId: 'evt-replay' },
        MAX_RETRY_ATTEMPTS,
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const updateCall = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(updateCall[0]).toContain('delivered_at = $3');
      expect(updateCall[1]).toEqual([
        MAX_RETRY_ATTEMPTS + 1,
        200,
        expect.any(Date),
        expect.any(Date),
        88,
      ]);
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

      mockQuery
        .mockResolvedValueOnce({ rows: [row1, row2] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await WebhookService.processRetries();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]?.[0]).toBe('https://degraded.example.com/callback');
      expect(fetchMock.mock.calls[1]?.[0]).toBe('https://healthy.example.com/callback');

      // Both deliveries should have been processed (one failed, one succeeded)
      expect(mockQuery).toHaveBeenCalledTimes(3);
      const updateCalls = mockQuery.mock.calls.filter((call) =>
        (call[0] as string).includes('UPDATE webhook_deliveries'),
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

      mockQuery
        .mockResolvedValueOnce({ rows: [row1, row2] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await WebhookService.processRetries();

      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Both deliveries should have been updated in DB
      const updateCalls = mockQuery.mock.calls.filter((call) =>
        (call[0] as string).includes('UPDATE webhook_deliveries'),
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
