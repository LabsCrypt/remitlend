import { jest } from '@jest/globals';
import request from 'supertest';

process.env.INTERNAL_API_KEY = 'test-metrics-key';

const queryMock = jest.fn(async (sql: string) => {
  if (sql.includes('FROM webhook_deliveries')) {
    return { rows: [{ count: 7 }], rowCount: 1 };
  }

  return { rows: [], rowCount: 0 };
});

jest.unstable_mockModule('../db/connection.js', () => ({
  withAdvisoryLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  default: {
    query: queryMock,
  },
  query: queryMock,
  getClient: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
  },
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
    getScoreConfig: jest.fn(() => ({
      repaymentDelta: 20,
      defaultPenalty: 50,
    })),
  },
}));

const { default: app } = await import('../app.js');
const { recordIndexerLedgers, recordScoreReconciliationRun, refreshWebhookRetryQueueDepth } =
  await import('../middleware/metrics.js');

describe('GET /metrics', () => {
  beforeEach(() => {
    queryMock.mockClear();
  });

  it('requires the internal API key', async () => {
    const response = await request(app).get('/metrics');

    expect(response.status).toBe(401);
  });

  it('exposes default and custom Prometheus metrics', async () => {
    recordIndexerLedgers(42, 50);
    recordScoreReconciliationRun(new Date('2026-05-27T00:00:00.000Z'));
    await refreshWebhookRetryQueueDepth();

    const response = await request(app).get('/metrics').set('x-api-key', 'test-metrics-key');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('process_cpu_user_seconds_total');
    expect(response.text).toContain('indexer_last_ledger 42');
    expect(response.text).toContain('indexer_chain_tip 50');
    expect(response.text).toContain('indexer_lag_ledgers 8');
    expect(response.text).toContain('webhook_retry_queue_depth 7');
    expect(response.text).toContain('score_reconciliation_last_run_timestamp');
    expect(response.text).toContain('http_request_duration_seconds_bucket');
  });

  it('uses route templates rather than raw path values for HTTP labels', async () => {
    await request(app).get('/api/loans/123');

    const response = await request(app).get('/metrics').set('x-api-key', 'test-metrics-key');

    expect(response.status).toBe(200);
    expect(response.text).not.toContain('/api/loans/123');
    expect(response.text).toMatch(
      /http_request_duration_seconds_bucket\{le="[^"]+",method="GET",route="(?:\/api\/loans)?\/:loanId",status_class="4xx"\}/,
    );
  });
});
