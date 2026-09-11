import { jest } from '@jest/globals';
import request from 'supertest';

// Set NODE_ENV to test to avoid production checks
process.env.NODE_ENV = 'test';

const mockQuery = jest
  .fn<() => Promise<{ rows: unknown[]; rowCount: number }>>()
  .mockResolvedValue({ rows: [], rowCount: 0 });

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

const { default: app } = await import('../app.js');

describe('Admin reindex endpoint', () => {
  const apiKey = 'test-internal-api-key';

  beforeAll(() => {
    process.env.INTERNAL_API_KEY = apiKey;
  });

  it('rejects requests without API key', async () => {
    const response = await request(app).post('/api/admin/reindex?fromLedger=1&toLedger=2');

    expect(response.status).toBe(401);
  });

  it('validates ledger range query parameters', async () => {
    const response = await request(app)
      .post('/api/admin/reindex?fromLedger=abc&toLedger=2')
      .set('x-api-key', apiKey);

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('rejects quarantine list requests without API key', async () => {
    const response = await request(app).get('/api/admin/quarantine-events');

    expect(response.status).toBe(401);
  });

  it('validates reprocess payload ids', async () => {
    const response = await request(app)
      .post('/api/admin/quarantine-events/reprocess')
      .set('x-api-key', apiKey)
      .send({ ids: [1, 'bad-id'] });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('rejects check-defaults payloads with more than 1000 loan IDs', async () => {
    const loanIds = Array.from({ length: 1001 }, (_, index) => index + 1);
    const response = await request(app)
      .post('/api/admin/check-defaults')
      .set('x-api-key', apiKey)
      .send({ loanIds });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });
});
