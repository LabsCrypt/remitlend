import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';

/**
 * Tests for GET /health/deep
 * Covers the fully-healthy scenario and the degraded (indexer lag) scenario.
 */

const mockDbQuery = jest
  .fn<(sql?: unknown) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>>()
  .mockResolvedValue({ rows: [{ last_indexed_ledger: 1000 }], rowCount: 1 });

jest.unstable_mockModule('../db/connection.js', () => ({
  withAdvisoryLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  default: { query: mockDbQuery },
  query: mockDbQuery,
  getClient: jest.fn(),
  withTransaction: jest.fn(),
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
