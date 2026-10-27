import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

jest.unstable_mockModule('../../db/connection.js', () => ({
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

describe('WebhookRetryProcessor', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
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
      mockQuery.mockResolvedValueOnce({
        rows: [deliveryRow({ attempt_count: MAX_RETRY_ATTEMPTS })],
      });

      await WebhookService.processRetries();

      expect(fetchMock).not.toHaveBeenCalled();
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

    it('dead-letters delivery on network error when max retry attempts are reached', async () => {
      const fetchMock = jest.fn(async () => {
        throw new Error('ECONNRESET: socket hang up');
      }) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      // attemptCount = 3 -> newAttemptCount = 4 (MAX_RETRY_ATTEMPTS)
      await WebhookService.retryWebhookDelivery(
        42,
        7,
        'https://deadletter.example.com/webhook',
        'dlq-secret',
        'evt-dlq-net',
        'LoanDefaulted',
        { eventId: 'evt-dlq-net', eventType: 'LoanDefaulted', loanId: 99 },
        3,
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const updateCall = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(updateCall[0]).toContain('UPDATE webhook_deliveries');
      expect(updateCall[1]?.[0]).toBe(4); // final attempt_count = MAX_RETRY_ATTEMPTS
      expect(updateCall[1]?.[1]).toBe('ECONNRESET: socket hang up');
      expect(updateCall[1]?.[2]).toBeNull(); // next_retry_at cleared to NULL (dead-lettered)
      expect(updateCall[1]?.[3]).toBeInstanceOf(Date); // updated_at
      expect(updateCall[1]?.[4]).toBe(42); // delivery id
    });

    it('persists dead-letter metadata and exposes dead-lettered deliveries via getSubscriptionDeliveries', async () => {
      const deadLetterRow = {
        id: 88,
        subscription_id: 12,
        event_id: 'evt-dlq-502',
        event_type: 'LoanRepaid',
        attempt_count: 4,
        last_status_code: 502,
        last_error: 'Webhook returned status 502',
        delivered_at: null,
        created_at: new Date('2025-02-01T00:00:00.000Z'),
        updated_at: new Date('2025-02-01T01:05:00.000Z'),
      };

      mockQuery.mockResolvedValueOnce({ rows: [deadLetterRow], rowCount: 1 });

      const service = new WebhookService();
      const deliveries = await service.getSubscriptionDeliveries(12, 25);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE subscription_id = $1'),
        [12, 25],
      );
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({
        id: 88,
        subscriptionId: 12,
        eventId: 'evt-dlq-502',
        eventType: 'LoanRepaid',
        attemptCount: 4,
        lastStatusCode: 502,
        lastError: 'Webhook returned status 502',
      });
      expect(deliveries[0]?.deliveredAt).toBeUndefined();
    });

    it('replays a re-queued dead-letter delivery to completion and clears next_retry_at', async () => {
      const fetchMock = jest.fn(async () => ({
        ok: true,
        status: 200,
      })) as unknown as jest.MockedFunction<typeof fetch>;
      global.fetch = fetchMock as unknown as typeof fetch;

      // Simulate operator re-queueing delivery #88 (attempt_count reset to 1, next_retry_at <= now)
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 88,
              subscription_id: 12,
              callback_url: 'https://recovered.example.com/webhook',
              secret: 'replay-secret',
              event_id: 'evt-dlq-502',
              event_type: 'LoanRepaid',
              payload: { eventId: 'evt-dlq-502', eventType: 'LoanRepaid', loanId: 12 },
              attempt_count: 1,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await WebhookService.processRetries();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const updateCall = mockQuery.mock.calls[1] as [string, unknown[]];
      expect(updateCall[0]).toContain('delivered_at = $3');
      expect(updateCall[0]).toContain('next_retry_at = NULL');
      expect(updateCall[1]?.[0]).toBe(2); // attempt_count incremented to 2 on replay
      expect(updateCall[1]?.[1]).toBe(200);
      expect(updateCall[1]?.[2]).toBeInstanceOf(Date);
      expect(updateCall[1]?.[4]).toBe(88);
    });

    it('releases inFlight lock and records job failure if post-retry queue depth refresh fails', async () => {
      jest.useFakeTimers();
      try {
        const { refreshWebhookRetryQueueDepth } = (await import('../../middleware/metrics.js')) as {
          refreshWebhookRetryQueueDepth: jest.Mock;
        };
        const { jobMetricsService } = await import('../jobMetricsService.js');

        mockQuery.mockResolvedValue({ rows: [] });
        refreshWebhookRetryQueueDepth
          .mockRejectedValueOnce(new Error('metrics db connection lost'))
          .mockResolvedValueOnce(undefined);

        startWebhookRetryProcessor();

        // Tick 1: refreshWebhookRetryQueueDepth rejects -> records failure and releases inFlight
        await jest.advanceTimersByTimeAsync(10_000);
        expect(jobMetricsService.recordFailure).toHaveBeenCalledWith(
          'webhookRetryProcessor',
          expect.any(Error),
          expect.any(Number),
        );

        // Tick 2: because inFlight was released in finally, the next tick executes and succeeds
        await jest.advanceTimersByTimeAsync(10_000);
        expect(jobMetricsService.recordSuccess).toHaveBeenCalledWith(
          'webhookRetryProcessor',
          expect.any(Number),
        );
      } finally {
        stopWebhookRetryProcessor();
        jest.useRealTimers();
      }
    });
  });
});
