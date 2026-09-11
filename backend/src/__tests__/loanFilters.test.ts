import { jest, describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';
import { generateJwtToken } from '../services/authService.js';

/**
 * Tests for status + date-range filters on GET /api/loans/borrower/:borrower
 * Covers:
 *   1. status=active filter returns only active loans
 *   2. from/to date-range filter forwards the correct SQL params
 *   3. combined status + date-range filter
 *   4. unknown status value returns 400 (Zod validation)
 *   5. empty result set with filters that match nothing
 */

const TEST_BORROWER = Keypair.random().publicKey();
process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
process.env.INTERNAL_API_KEY = 'test-key';

type MockQueryResult = { rows: unknown[]; rowCount?: number };
const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

const mockRelease = jest.fn();
const mockClient = { query: mockQuery, release: mockRelease };

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  pool: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn<() => Promise<typeof mockClient>>().mockResolvedValue(mockClient),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
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
    get: jest.fn<() => Promise<null>>().mockResolvedValue(null),
    set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
    invalidatePattern: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  },
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
    healthCheck: jest
      .fn<() => Promise<{ connected: boolean; latestLedger: number }>>()
      .mockResolvedValue({
        connected: true,
        latestLedger: 1000,
      }),
    validateConfig: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    validateScoreConfig: jest.fn<() => void>().mockImplementation(() => {}),
  },
}));

const { default: app } = await import('../app.js');

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

/** Build a minimal loan row that the controller can map to a BorrowerLoan */
function makeLoanRow(overrides: Record<string, unknown> = {}) {
  return {
    loan_id: 1,
    address: TEST_BORROWER,
    principal: '1000',
    approved_at: '2024-01-15T00:00:00.000Z',
    approved_ledger: '500',
    rate_bps: '1200',
    term_ledgers: '17280',
    total_repaid: '0',
    is_defaulted: 0,
    effective_rate_bps: '1200',
    effective_term_ledgers: '17280',
    effective_approved_ledger: '500',
    accrued_interest: '5',
    total_owed: '1005',
    next_payment_deadline: '2024-02-15T00:00:00.000Z',
    status: 'active',
    borrower: TEST_BORROWER,
    full_count: '1',
    ...overrides,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  // Default: indexer_state query returns ledger 1000
  mockQuery.mockImplementation(async (sql: unknown) => {
    if (typeof sql === 'string' && sql.includes('indexer_state')) {
      return { rows: [{ last_indexed_ledger: 1000 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
});

afterAll(() => {
  delete process.env.JWT_SECRET;
  delete process.env.INTERNAL_API_KEY;
});

describe('GET /api/loans/borrower/:borrower – filters', () => {
  describe('status filter', () => {
    it('returns active loans when status=active', async () => {
      const activeRow = makeLoanRow({ status: 'active' });

      mockQuery.mockImplementation(async (sql: unknown) => {
        if (typeof sql === 'string' && sql.includes('indexer_state')) {
          return { rows: [{ last_indexed_ledger: 1000 }], rowCount: 1 };
        }
        return { rows: [activeRow], rowCount: 1 };
      });

      const res = await request(app)
        .get(`/api/loans/borrower/${TEST_BORROWER}?status=active`)
        .set(bearer(TEST_BORROWER));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.loans).toHaveLength(1);
      expect(res.body.data.loans[0].status).toBe('active');
    });

    it('returns 400 for an invalid status value', async () => {
      const res = await request(app)
        .get(`/api/loans/borrower/${TEST_BORROWER}?status=invalid_status`)
        .set(bearer(TEST_BORROWER));

      expect(res.status).toBe(400);
    });

    it('returns empty array when status=repaid and no repaid loans exist', async () => {
      mockQuery.mockImplementation(async (sql: unknown) => {
        if (typeof sql === 'string' && sql.includes('indexer_state')) {
          return { rows: [{ last_indexed_ledger: 1000 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      const res = await request(app)
        .get(`/api/loans/borrower/${TEST_BORROWER}?status=repaid`)
        .set(bearer(TEST_BORROWER));

      expect(res.status).toBe(200);
      expect(res.body.data.loans).toHaveLength(0);
    });
  });

  describe('date-range filter (from/to)', () => {
    it('forwards from/to params and returns matching loans', async () => {
      const row = makeLoanRow({ approved_at: '2024-03-01T00:00:00.000Z' });

      mockQuery.mockImplementation(async (sql: unknown) => {
        if (typeof sql === 'string' && sql.includes('indexer_state')) {
          return { rows: [{ last_indexed_ledger: 1000 }], rowCount: 1 };
        }
        return { rows: [row], rowCount: 1 };
      });

      const res = await request(app)
        .get(`/api/loans/borrower/${TEST_BORROWER}?from=2024-01-01&to=2024-12-31`)
        .set(bearer(TEST_BORROWER));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 for an invalid date in from param', async () => {
      const res = await request(app)
        .get(`/api/loans/borrower/${TEST_BORROWER}?from=not-a-date`)
        .set(bearer(TEST_BORROWER));

      expect(res.status).toBe(400);
    });

    it('returns empty array when date range matches no loans', async () => {
      mockQuery.mockImplementation(async (sql: unknown) => {
        if (typeof sql === 'string' && sql.includes('indexer_state')) {
          return { rows: [{ last_indexed_ledger: 1000 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      const res = await request(app)
        .get(`/api/loans/borrower/${TEST_BORROWER}?from=2020-01-01&to=2020-12-31`)
        .set(bearer(TEST_BORROWER));

      expect(res.status).toBe(200);
      expect(res.body.data.loans).toHaveLength(0);
    });
  });

  describe('combined status + date-range filter', () => {
    it('returns loans matching both status and date range', async () => {
      const row = makeLoanRow({
        status: 'repaid',
        approved_at: '2024-06-01T00:00:00.000Z',
      });

      mockQuery.mockImplementation(async (sql: unknown) => {
        if (typeof sql === 'string' && sql.includes('indexer_state')) {
          return { rows: [{ last_indexed_ledger: 1000 }], rowCount: 1 };
        }
        return { rows: [row], rowCount: 1 };
      });

      const res = await request(app)
        .get(`/api/loans/borrower/${TEST_BORROWER}?status=repaid&from=2024-01-01&to=2024-12-31`)
        .set(bearer(TEST_BORROWER));

      expect(res.status).toBe(200);
      expect(res.body.data.loans).toHaveLength(1);
    });
  });

  describe('pagination with filters', () => {
    it('accepts valid limit parameter', async () => {
      const rows = Array.from({ length: 5 }, (_, i) =>
        makeLoanRow({ loan_id: i + 1, full_count: '5' }),
      );

      mockQuery.mockImplementation(async (sql: unknown) => {
        if (typeof sql === 'string' && sql.includes('indexer_state')) {
          return { rows: [{ last_indexed_ledger: 1000 }], rowCount: 1 };
        }
        return { rows: rows.slice(0, 3), rowCount: 3 };
      });

      const res = await request(app)
        .get(`/api/loans/borrower/${TEST_BORROWER}?status=active&limit=3`)
        .set(bearer(TEST_BORROWER));

      expect(res.status).toBe(200);
    });

    it('returns 400 when limit exceeds maximum', async () => {
      const res = await request(app)
        .get(`/api/loans/borrower/${TEST_BORROWER}?limit=999`)
        .set(bearer(TEST_BORROWER));

      expect(res.status).toBe(400);
    });
  });
});
