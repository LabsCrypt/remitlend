import request from 'supertest';
import { jest } from '@jest/globals';
import { generateJwtToken } from '../services/authService.js';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const VALID_API_KEY = 'test-internal-key';
const LENDER_WALLET = 'GAAAALENDER123456789';

// Set NODE_ENV to test to avoid production checks
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
process.env.INTERNAL_API_KEY = VALID_API_KEY;
process.env.LENDER_WALLETS = LENDER_WALLET;

// ── DB mock (used by pool controller) ────────────────────────────────────────
const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

const mockPool = {
  query: mockQuery,
  end: jest.fn(),
  connect: jest.fn(),
  totalCount: 0,
  idleCount: 0,
  waitingCount: 0,
};

jest.unstable_mockModule('../db/connection.js', () => ({
  default: mockPool,
  pool: mockPool,
  query: mockQuery,
  getClient: jest.fn(),
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
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
  },
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
    healthCheck: jest.fn<() => Promise<{ connected: boolean; latestLedger: number }>>()
      .mockResolvedValue({ connected: true, latestLedger: 12345 }),
    validateConfig: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    validateScoreConfig: jest.fn<() => void>().mockImplementation(() => {}),
  },
}));

// ── notificationService mock ─────────────────────────────────────────────────
const mockGetNotificationsForUser = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const mockGetUnreadCount = jest.fn<(...args: unknown[]) => Promise<number>>();
const mockSubscribe = jest.fn();
jest.unstable_mockModule('../services/notificationService.js', () => ({
  notificationService: {
    getNotificationsForUser: mockGetNotificationsForUser,
    getUnreadCount: mockGetUnreadCount,
    subscribe: mockSubscribe,
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  },
}));

// ── eventStreamService mock ──────────────────────────────────────────────────
const mockGetConnectionCount = jest.fn();
jest.unstable_mockModule('../services/eventStreamService.js', () => ({
  eventStreamService: {
    getConnectionCount: mockGetConnectionCount,
    subscribeBorrower: jest.fn(),
    subscribeAll: jest.fn(),
  },
}));

await import('../db/connection.js');
await import('../services/notificationService.js');
await import('../services/eventStreamService.js');
const { default: app } = await import('../app.js');

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

afterEach(() => {
  jest.clearAllMocks();
});

afterAll(() => {
  delete process.env.INTERNAL_API_KEY;
  delete process.env.JWT_SECRET;
  delete process.env.LENDER_WALLETS;
});

// ---------------------------------------------------------------------------
// /api/v1 route mounts
// ---------------------------------------------------------------------------
describe('/api/v1 route mounts', () => {
  it('GET /api/v1/pool/stats returns 200 with lender auth', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ total_deposits: '10000' }],
      })
      .mockResolvedValueOnce({
        rows: [{ active_loans_count: '3', total_outstanding: '5000' }],
      });

    const response = await request(app).get('/api/v1/pool/stats').set(bearer(LENDER_WALLET));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('GET /api/v1/notifications returns 200 with borrower auth', async () => {
    mockGetNotificationsForUser.mockResolvedValueOnce([]);
    mockGetUnreadCount.mockResolvedValueOnce(0);

    const response = await request(app)
      .get('/api/v1/notifications')
      .set(bearer('GAAABORROWER123456789'));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('GET /api/v1/events/status returns 200 with API key', async () => {
    mockGetConnectionCount.mockReturnValueOnce({
      borrower: 0,
      admin: 0,
      total: 0,
    });

    const response = await request(app)
      .get('/api/v1/events/status')
      .set('x-api-key', VALID_API_KEY);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
