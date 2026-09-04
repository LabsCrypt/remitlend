import { jest } from '@jest/globals';
import request from 'supertest';

jest.setTimeout(60000);

// Set NODE_ENV to test to avoid production checks
process.env.NODE_ENV = 'test';

const loadApp = async () => {
  jest.resetModules();
  const mockQuery = jest
    .fn<(sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>>()
    .mockResolvedValue({ rows: [], rowCount: 0 });

  jest.unstable_mockModule('../db/connection.js', () => ({
    default: {
      query: mockQuery,
    },
    pool: {
      query: mockQuery,
    },
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

  return import('../app.js');
};

describe('CORS middleware', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://frontend.example.com';
    delete process.env.CORS_ALLOWED_ORIGINS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('allows the configured frontend origin', async () => {
    const { default: app } = await loadApp();

    const response = await request(app)
      .get('/health')
      .set('Origin', 'https://frontend.example.com');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('https://frontend.example.com');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('rejects unknown origins in production', async () => {
    const { default: app } = await loadApp();

    const response = await request(app)
      .get('/health')
      .set('Origin', 'https://malicious.example.com');

    expect(response.status).toBe(403);
    expect(response.body.error?.message).toBe('Origin is not allowed by CORS policy');
  });

  it('rejects unknown origins even when NODE_ENV is not production', async () => {
    process.env.NODE_ENV = 'development';
    process.env.FRONTEND_URL = 'http://localhost:3000';

    const { default: app } = await loadApp();

    const response = await request(app).get('/health').set('Origin', 'https://evil-corp.io');

    expect(response.status).toBe(403);
    expect(response.body.error?.message).toBe('Origin is not allowed by CORS policy');
  });

  it('allows localhost origins when NODE_ENV is not production', async () => {
    process.env.NODE_ENV = 'development';
    process.env.FRONTEND_URL = 'http://localhost:3000';

    const { default: app } = await loadApp();

    const response = await request(app).get('/health').set('Origin', 'http://127.0.0.1:3000');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://127.0.0.1:3000');
  });
});
