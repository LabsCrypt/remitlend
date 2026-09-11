import { jest } from '@jest/globals';
import request from 'supertest';

// Set NODE_ENV to test to avoid production checks
process.env.NODE_ENV = 'test';

jest.unstable_mockModule('../db/connection.js', () => ({
  default: {
    query: jest
      .fn<() => Promise<{ rows: unknown[]; rowCount: number }>>()
      .mockResolvedValue({ rows: [], rowCount: 0 }),
  },
  pool: {
    query: jest
      .fn<() => Promise<{ rows: unknown[]; rowCount: number }>>()
      .mockResolvedValue({ rows: [], rowCount: 0 }),
  },
  query: jest
    .fn<() => Promise<{ rows: unknown[]; rowCount: number }>>()
    .mockResolvedValue({ rows: [], rowCount: 0 }),
  getClient: jest.fn(),
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
    getScoreConfig: jest.fn(() => ({
      repaymentDelta: 20,
      defaultPenalty: 50,
    })),
  },
}));

const { default: app } = await import('../app.js');

describe('Swagger docs', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalEnableSwagger = process.env.ENABLE_SWAGGER;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalEnableSwagger === undefined) {
      delete process.env.ENABLE_SWAGGER;
    } else {
      process.env.ENABLE_SWAGGER = originalEnableSwagger;
    }
  });

  it('serves Swagger UI and raw OpenAPI JSON when enabled', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.ENABLE_SWAGGER;

    const docsResponse = await request(app).get('/docs/');
    expect(docsResponse.status).toBe(200);
    expect(docsResponse.text).toContain('Swagger UI');

    const jsonResponse = await request(app).get('/docs.json');
    expect(jsonResponse.status).toBe(200);
    expect(jsonResponse.body.openapi).toBe('3.0.0');
    expect(jsonResponse.body.components.schemas.ErrorResponse).toBeDefined();
  });

  it('returns 404 for docs endpoints in production unless explicitly enabled', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENABLE_SWAGGER;

    await request(app).get('/docs/').expect(404);
    await request(app).get('/docs.json').expect(404);
  });

  it('allows docs in production when ENABLE_SWAGGER=true', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_SWAGGER = 'true';

    await request(app).get('/docs/').expect(200);
    await request(app).get('/docs.json').expect(200);
  });

  it('API routes do not have unsafe-inline in script-src CSP', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.ENABLE_SWAGGER;

    const res = await request(app).get('/');
    const csp = res.headers['content-security-policy'] ?? '';
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('/docs route has unsafe-inline in script-src for Swagger UI', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.ENABLE_SWAGGER;

    const res = await request(app).get('/docs/');
    const csp = res.headers['content-security-policy'] ?? '';
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
    expect(scriptSrc).toContain("'unsafe-inline'");
  });
});
