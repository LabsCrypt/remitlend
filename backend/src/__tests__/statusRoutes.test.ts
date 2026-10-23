import request from 'supertest';
import { jest } from '@jest/globals';

const mockQuery = jest.fn<(sql: string) => Promise<{ rows: unknown[] }>>();
const mockCachePing = jest.fn<() => Promise<string>>();
const mockSorobanPing = jest.fn<() => Promise<string>>();
const mockSorobanHealthCheck =
  jest.fn<() => Promise<{ connected: boolean; latestLedger: number }>>();

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    ping: mockCachePing,
  },
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    ping: mockSorobanPing,
    healthCheck: mockSorobanHealthCheck,
  },
}));

const { default: app } = await import('../app.js');
const { setPauseState } = await import('../middleware/pauseGuard.js');

const healthyIndex = (lastIndexedLedger = 900) => {
  mockQuery.mockImplementation(async (sql) =>
    sql.includes('indexer_state')
      ? { rows: [{ last_indexed_ledger: lastIndexedLedger }] }
      : { rows: [] },
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  healthyIndex();
  mockCachePing.mockResolvedValue('ok');
  mockSorobanPing.mockResolvedValue('ok');
  mockSorobanHealthCheck.mockResolvedValue({ connected: true, latestLedger: 1000 });
});

describe('GET /health', () => {
  it('returns 200 when all dependencies are healthy', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'ok',
        checks: { api: 'ok', database: 'ok', redis: 'ok', soroban_rpc: 'ok' },
        uptime: expect.any(Number),
        timestamp: expect.any(Number),
      }),
    );
  });

  it('returns 200 degraded when only Soroban RPC is unavailable', async () => {
    mockSorobanPing.mockRejectedValueOnce(new Error('RPC unavailable'));

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('degraded');
    expect(response.body.checks).toEqual(
      expect.objectContaining({ database: 'ok', redis: 'ok', soroban_rpc: 'error' }),
    );
  });

  it.each([
    ['database', () => mockQuery.mockRejectedValueOnce(new Error('database unavailable'))],
    ['redis', () => mockCachePing.mockRejectedValueOnce(new Error('Redis unavailable'))],
  ])('returns 503 down when the core %s dependency fails', async (_dependency, failDependency) => {
    failDependency();

    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('down');
  });
});

describe('GET /health/deep', () => {
  const originalLagLimit = process.env.INDEXER_HEALTH_LAG_LIMIT;

  beforeEach(() => {
    process.env.INDEXER_HEALTH_LAG_LIMIT = '100';
  });

  afterAll(() => {
    if (originalLagLimit === undefined) {
      delete process.env.INDEXER_HEALTH_LAG_LIMIT;
    } else {
      process.env.INDEXER_HEALTH_LAG_LIMIT = originalLagLimit;
    }
  });

  it('returns 200 at the exact indexer lag limit', async () => {
    healthyIndex(900);

    const response = await request(app).get('/health/deep');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'ok',
        checks: expect.objectContaining({
          indexer: { status: 'ok', lagLedgers: 100 },
        }),
      }),
    );
  });

  it('returns 200 degraded when indexer lag exceeds the limit', async () => {
    healthyIndex(899);

    const response = await request(app).get('/health/deep');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('degraded');
    expect(response.body.checks.indexer).toEqual({ status: 'degraded', lagLedgers: 101 });
  });

  it('returns 503 down when a dependency is unavailable', async () => {
    mockSorobanHealthCheck.mockRejectedValueOnce(new Error('RPC unavailable'));

    const response = await request(app).get('/health/deep');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('down');
    expect(response.body.checks.stellarRpc).toBe('down');
  });
});

describe('GET /api/status/pause', () => {
  it('is public and returns the current pause state shape', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          is_paused: true,
          paused_at: new Date('2026-02-03T04:05:06.000Z'),
          reason: 'scheduled maintenance',
          contracts: ['CONTRACT_A'],
        },
      ],
    });

    const response = await request(app).get('/api/status/pause');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        isPaused: true,
        pausedAt: '2026-02-03T04:05:06.000Z',
        reason: 'scheduled maintenance',
        contracts: ['CONTRACT_A'],
        timestamp: expect.any(String),
      }),
    );
  });

  it('fails open with the last pause state when the database is unavailable', async () => {
    await setPauseState(true, ['CONTRACT_A'], 'scheduled maintenance');
    mockQuery.mockRejectedValueOnce(new Error('database unavailable'));

    const response = await request(app).get('/api/status/pause');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        isPaused: true,
        reason: 'scheduled maintenance',
        contracts: ['CONTRACT_A'],
      }),
    );
  });
});
