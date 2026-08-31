import { jest } from '@jest/globals';
import request from 'supertest';

// Set NODE_ENV to test to avoid production checks
process.env.NODE_ENV = 'test';

// Must mock all app-level dependencies before importing app.

jest.unstable_mockModule('../db/connection.js', () => ({
  default: {
    query: jest.fn<() => Promise<any>>().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
  pool: {
    query: jest.fn<() => Promise<any>>().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
  query: jest.fn<() => Promise<any>>().mockResolvedValue({ rows: [], rowCount: 0 }),
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
  },
}));

const { default: app } = await import('../app.js');

describe('GET /version', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Snapshot and clear the build-time env vars so each test starts clean.
    for (const key of [
      'GIT_SHA',
      'BUILD_TIME',
      'LOAN_MANAGER_CONTRACT_ID',
      'LENDING_POOL_CONTRACT_ID',
      'REMITTANCE_NFT_CONTRACT_ID',
      'MULTISIG_GOVERNANCE_CONTRACT_ID',
    ]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    // Restore original env.
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('returns 200', async () => {
    const res = await request(app).get('/version');
    expect(res.status).toBe(200);
  });

  it('response shape contains all required fields', async () => {
    const res = await request(app).get('/version');
    expect(res.body).toHaveProperty('gitSha');
    expect(res.body).toHaveProperty('builtAt');
    expect(res.body).toHaveProperty('nodeVersion');
    expect(res.body).toHaveProperty('contracts');
    expect(res.body.contracts).toHaveProperty('loanManager');
    expect(res.body.contracts).toHaveProperty('lendingPool');
    expect(res.body.contracts).toHaveProperty('remittanceNft');
    expect(res.body.contracts).toHaveProperty('multisigGovernance');
  });

  it("falls back to 'unknown' when GIT_SHA and BUILD_TIME are not set", async () => {
    const res = await request(app).get('/version');
    expect(res.body.gitSha).toBe('unknown');
    expect(res.body.builtAt).toBe('unknown');
  });

  it('reflects GIT_SHA and BUILD_TIME env vars when set', async () => {
    process.env.GIT_SHA = 'abc1234def5678';
    process.env.BUILD_TIME = '2025-06-01T12:00:00Z';

    const res = await request(app).get('/version');
    expect(res.body.gitSha).toBe('abc1234def5678');
    expect(res.body.builtAt).toBe('2025-06-01T12:00:00Z');
  });

  it('reflects contract IDs from environment variables', async () => {
    process.env.LOAN_MANAGER_CONTRACT_ID = 'CLOAN';
    process.env.LENDING_POOL_CONTRACT_ID = 'CPOOL';
    process.env.REMITTANCE_NFT_CONTRACT_ID = 'CNFT';
    process.env.MULTISIG_GOVERNANCE_CONTRACT_ID = 'CGOV';

    const res = await request(app).get('/version');
    expect(res.body.contracts.loanManager).toBe('CLOAN');
    expect(res.body.contracts.lendingPool).toBe('CPOOL');
    expect(res.body.contracts.remittanceNft).toBe('CNFT');
    expect(res.body.contracts.multisigGovernance).toBe('CGOV');
  });

  it("contract IDs fall back to 'unknown' when env vars are absent", async () => {
    const res = await request(app).get('/version');
    expect(res.body.contracts.loanManager).toBe('unknown');
    expect(res.body.contracts.lendingPool).toBe('unknown');
    expect(res.body.contracts.remittanceNft).toBe('unknown');
    expect(res.body.contracts.multisigGovernance).toBe('unknown');
  });

  it('nodeVersion matches the running Node.js process', async () => {
    const res = await request(app).get('/version');
    expect(res.body.nodeVersion).toBe(process.version);
  });
});
