import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';

// Set NODE_ENV to test to avoid production checks
process.env.NODE_ENV = 'test';

/**
 * Tests for GET /health/deep
 * Covers the fully-healthy scenario and the degraded (indexer lag) scenario.
 */

const mockDbQuery = jest
  .fn<(sql?: unknown) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>>()
  .mockResolvedValue({ rows: [{ last_indexed_ledger: 1000 }], rowCount: 1 });

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockDbQuery },
  pool: { query: mockDbQuery },
  query: mockDbQuery,
  getClient: jest.fn(),
  withTransaction: jest.fn(),
  closePool: jest.fn(),
}));

jest.unstable_mockModule('../config/loanConfig.js', () => ({
  validateLoanConfigOnStartup: jest.fn<() => void>().mockImplementation(() => {}),
  getLoanConfig: jest.fn<() => { minScore: number; maxAmount: number; interestRatePercent: number; creditScoreThreshold: number }>()
    .mockReturnValue({
      minScore: 500,
      maxAmount: 10000,
      interestRatePercent: 12,
      creditScoreThreshold: 650,
    }),
  validateLoanConfig: jest.fn<() => { minScore: number; maxAmount: number; interestRatePercent: number; creditScoreThreshold: number }>()
    .mockReturnValue({
      minScore: 500,
      maxAmount: 10000,
      interestRatePercent: 12,
      creditScoreThreshold: 650,
    }),
}));

jest.unstable_mockModule('../middleware/pauseGuard.js', () => ({
  initializePauseState: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  setPauseState: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  updatePauseStateFromDatabase: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  pauseGuard: jest.fn<() => void>().mockImplementation((req, _res, next) => next()),
  getPauseState: jest.fn<() => Promise<void>>().mockImplementation((req, res) => res.json({
    success: true,
    data: {
      isPaused: false,
      pausedAt: null,
      reason: null,
      contracts: [],
      timestamp: new Date(),
    },
  })),
  getCurrentPauseState: jest.fn<() => { isPaused: boolean; pausedAt: Date | null; reason: string | null; contracts: string[] }>()
    .mockReturnValue({
      isPaused: false,
      pausedAt: null,
      reason: null,
      contracts: [],
    }),
}));

jest.unstable_mockModule('../config/sentry.js', () => ({
  initSentry: jest.fn<() => void>().mockImplementation(() => {}),
  Sentry: {
    captureException: jest.fn(),
    init: jest.fn(),
    setupExpressErrorHandler: jest.fn<() => void>().mockImplementation(() => {}),
  },
}));

jest.unstable_mockModule('../config/swagger.js', () => ({
  mountSwaggerDocs: jest.fn<() => void>().mockImplementation(() => {}),
  isSwaggerEnabled: jest.fn<() => boolean>().mockReturnValue(false),
  swaggerSpec: {},
}));

jest.unstable_mockModule('../middleware/rateLimiter.js', () => ({
  globalRateLimiter: jest.fn<() => void>().mockImplementation((req, _res, next) => next()),
  strictRateLimiter: jest.fn<() => void>().mockImplementation((req, _res, next) => next()),
  challengeRateLimiter: jest.fn<() => void>().mockImplementation((req, _res, next) => next()),
  loginRateLimiter: jest.fn<() => void>().mockImplementation((req, _res, next) => next()),
  ipLoginRateLimiter: jest.fn<() => void>().mockImplementation((req, _res, next) => next()),
  verifyRateLimiter: jest.fn<() => void>().mockImplementation((req, _res, next) => next()),
  simulationRateLimiter: jest.fn<() => void>().mockImplementation((req, _res, next) => next()),
  createRateLimiter: jest.fn<() => void>().mockImplementation(() => (req, _res, next) => next()),
}));

jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
    get: jest.fn<() => Promise<null>>().mockResolvedValue(null),
    set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  },
}));

const mockHealthCheck = jest
  .fn<() => Promise<{ connected: boolean; latestLedger?: number }>>()
  .mockResolvedValue({
    connected: true,
    latestLedger: 1050,
  });

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
    healthCheck: mockHealthCheck,
    validateConfig: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    validateScoreConfig: jest.fn<() => void>().mockImplementation(() => {}),
  },
}));

const { default: app } = await import('../app.js');

describe('GET /health/deep', () => {
  beforeEach(() => {
    mockDbQuery.mockReset();
    mockHealthCheck.mockReset();
  });

  describe('all healthy', () => {
    beforeEach(() => {
      // RPC returns ledger 1050; indexer is at 1000 → lag = 50 (below default threshold of 100)
      mockHealthCheck.mockResolvedValue({
        connected: true,
        latestLedger: 1050,
      });
      mockDbQuery.mockImplementation(async (sql: unknown) => {
        if (typeof sql === 'string' && sql.includes('indexer_state')) {
          return { rows: [{ last_indexed_ledger: 1000 }], rowCount: 1 };
        }
        return { rows: [{ '?column?': 1 }], rowCount: 1 };
      });
    });

    it('returns HTTP 200', async () => {
      const res = await request(app).get('/health/deep');
      expect(res.status).toBe(200);
    });

    it('returns overall status ok', async () => {
      const res = await request(app).get('/health/deep');
      expect(res.body.status).toBe('ok');
    });

    it('includes all four check keys', async () => {
      const res = await request(app).get('/health/deep');
      expect(res.body.checks).toHaveProperty('db');
      expect(res.body.checks).toHaveProperty('redis');
      expect(res.body.checks).toHaveProperty('stellarRpc');
      expect(res.body.checks).toHaveProperty('indexer');
      expect(res.body.checks.indexer).toHaveProperty('lagLedgers');
    });

    it('reports db, redis, stellarRpc as ok', async () => {
      const res = await request(app).get('/health/deep');
      expect(res.body.checks.db).toBe('ok');
      expect(res.body.checks.redis).toBe('ok');
      expect(res.body.checks.stellarRpc).toBe('ok');
    });

    it('reports indexer status ok when lag is within threshold', async () => {
      const res = await request(app).get('/health/deep');
      expect(res.body.checks.indexer.status).toBe('ok');
      expect(res.body.checks.indexer.lagLedgers).toBe(50);
    });
  });

  describe('degraded – indexer lag exceeds threshold', () => {
    beforeEach(() => {
      process.env.INDEXER_HEALTH_LAG_LIMIT = '30';
      // RPC is at 1100; indexer at 1000 → lag = 100 which exceeds 30
      mockHealthCheck.mockResolvedValue({
        connected: true,
        latestLedger: 1100,
      });
      mockDbQuery.mockImplementation(async (sql: unknown) => {
        if (typeof sql === 'string' && sql.includes('indexer_state')) {
          return { rows: [{ last_indexed_ledger: 1000 }], rowCount: 1 };
        }
        return { rows: [{ '?column?': 1 }], rowCount: 1 };
      });
    });

    it('returns HTTP 200 (not 503) when only indexer is degraded', async () => {
      const res = await request(app).get('/health/deep');
      expect(res.status).toBe(200);
    });

    it('returns overall status degraded', async () => {
      const res = await request(app).get('/health/deep');
      expect(res.body.status).toBe('degraded');
    });

    it('reports indexer status as degraded', async () => {
      const res = await request(app).get('/health/deep');
      expect(res.body.checks.indexer.status).toBe('degraded');
    });
  });

  describe('RPC down → 503', () => {
    beforeEach(() => {
      mockHealthCheck.mockResolvedValue({ connected: false });
      mockDbQuery.mockImplementation(async (sql: unknown) => {
        if (typeof sql === 'string' && sql.includes('indexer_state')) {
          return { rows: [{ last_indexed_ledger: 1000 }], rowCount: 1 };
        }
        return { rows: [{ '?column?': 1 }], rowCount: 1 };
      });
    });

    it('returns HTTP 503 when stellarRpc is down', async () => {
      const res = await request(app).get('/health/deep');
      expect(res.status).toBe(503);
    });

    it('returns overall status down', async () => {
      const res = await request(app).get('/health/deep');
      expect(res.body.status).toBe('down');
    });

    it('reports stellarRpc as down', async () => {
      const res = await request(app).get('/health/deep');
      expect(res.body.checks.stellarRpc).toBe('down');
    });
  });
});
