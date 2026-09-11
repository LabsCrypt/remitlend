import { jest } from '@jest/globals';
import request from 'supertest';

// Set NODE_ENV to test to avoid production checks
process.env.NODE_ENV = 'test';

const mockQuery = jest.fn();

const mockPool = {
  query: mockQuery,
  end: jest.fn(),
  connect: jest.fn(),
  totalCount: 0,
  idleCount: 0,
  waitingCount: 0,
};

// Mock the database connection module before any other imports
jest.unstable_mockModule('../db/connection.js', () => ({
  default: mockPool,
  pool: mockPool,
  query: mockQuery,
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

// Mock CacheService to prevent Redis connections
jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    get: jest.fn<() => Promise<null>>().mockResolvedValue(null),
    set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
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

// rateLimitService talks to Redis. Without an explicit mock the middleware
// blocks waiting on the (unmocked) client and the test hits its 5s timeout.
jest.unstable_mockModule('../services/rateLimitService.js', () => ({
  rateLimitService: {
    checkRateLimit: jest
      .fn<
        () => Promise<{
          allowed: boolean;
          remaining: number;
          resetTime: Date;
          currentCount: number;
        }>
      >()
      .mockResolvedValue({
        allowed: true,
        remaining: 100,
        resetTime: new Date(Date.now() + 60_000),
        currentCount: 0,
      }),
  },
  SCORE_UPDATE_RATE_LIMIT: { maxRequests: 100, windowSeconds: 60 },
}));

// Dynamic imports to ensure mocks are applied
const { query } = await import('../db/connection.js');
const { generateJwtToken } = await import('../services/authService.js');

// Set env vars
process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
process.env.INTERNAL_API_KEY = 'test-internal-key';

const { default: app } = await import('../app.js');

const mockedQuery = query as jest.MockedFunction<typeof query>;

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

describe('GET /api/score/:userId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should reject unauthenticated requests', async () => {
    const response = await request(app).get('/api/score/user123');
    expect(response.status).toBe(401);
  });

  it('should reject when path userId does not match JWT wallet', async () => {
    const response = await request(app).get('/api/score/user123').set(bearer('other-wallet'));

    expect(response.status).toBe(403);
  });

  it('should return a score for a valid userId', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ score: 750 }],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    const response = await request(app).get('/api/score/user123').set(bearer('user123'));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.userId).toBe('user123');
    expect(response.body.score).toBe(750);
  });

  it('should return the same score for the same userId', async () => {
    mockedQuery.mockResolvedValue({
      rows: [{ score: 600 }],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    const r1 = await request(app).get('/api/score/alice').set(bearer('alice'));
    const r2 = await request(app).get('/api/score/alice').set(bearer('alice'));

    expect(r1.body.score).toBe(r2.body.score);
  });

  it('should return 500 if user not found', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [],
      command: 'SELECT',
      rowCount: 0,
      oid: 0,
      fields: [],
    });

    const response = await request(app).get('/api/score/newuser').set(bearer('newuser'));

    expect(response.status).toBe(200);
    expect(response.body.score).toBe(500);
  });
});

describe('POST /api/score/update', () => {
  it('should increase score by 15 for on-time repayment', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ score: 500 }],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    });
    mockedQuery.mockResolvedValueOnce({
      rows: [{ score: 515 }],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    const response = await request(app)
      .post('/api/score/update')
      .set('x-api-key', 'test-internal-key')
      .send({ userId: 'user123', repaymentAmount: 500, onTime: true });

    expect(response.status).toBe(200);
    expect(response.body.newScore).toBe(515);
  });

  it('should reject negative repaymentAmount', async () => {
    const response = await request(app)
      .post('/api/score/update')
      .set('x-api-key', 'test-internal-key')
      .send({ userId: 'user123', repaymentAmount: -100, onTime: true });

    expect(response.status).toBe(400);
  });
});
