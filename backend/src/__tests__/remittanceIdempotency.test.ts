import request from 'supertest';
import { jest } from '@jest/globals';
import { Keypair } from '@stellar/stellar-sdk';
import jwt from 'jsonwebtoken';

// Set NODE_ENV to test to avoid production checks
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';

const SENDER = Keypair.random().publicKey();
const RECIPIENT = Keypair.random().publicKey();

let createdCount = 0;
const mockCreateRemittance = jest.fn(async () => {
  // Slight artificial delay so the in-flight reservation is still held when a
  // concurrent duplicate request reaches the middleware in the "409 while in
  // progress" test below.
  await new Promise((resolve) => setTimeout(resolve, 80));
  createdCount += 1;
  return {
    id: `remittance-${createdCount}`,
    senderId: SENDER,
    recipientAddress: RECIPIENT,
    amount: 100,
    fromCurrency: 'USDC',
    toCurrency: 'USDC',
    status: 'pending' as const,
    xdr: 'AAAA...',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
});

const mockQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });

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

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
    healthCheck: jest.fn<() => Promise<{ connected: boolean; latestLedger: number }>>()
      .mockResolvedValue({ connected: true, latestLedger: 12345 }),
    validateConfig: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    validateScoreConfig: jest.fn<() => void>().mockImplementation(() => {}),
  },
}));

jest.unstable_mockModule('../services/remittanceService.js', () => ({
  remittanceService: {
    createRemittance: mockCreateRemittance,
    getRemittances: jest.fn(),
    getRemittance: jest.fn(),
    updateRemittanceStatus: jest.fn(),
  },
}));

const fakeCacheStore = new Map<string, unknown>();
jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    get: jest.fn(async (key: string) => fakeCacheStore.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      fakeCacheStore.set(key, value);
    }),
    setNotExists: jest.fn(async (key: string, value: unknown) => {
      if (fakeCacheStore.has(key)) return false;
      fakeCacheStore.set(key, value);
      return true;
    }),
    delete: jest.fn(async (key: string) => {
      fakeCacheStore.delete(key);
    }),
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
  },
}));

const { default: app } = await import('../app.js');

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${jwt.sign(
    { publicKey, role: 'borrower', scopes: ['write:remittances'] },
    process.env.JWT_SECRET!,
    { algorithm: 'HS256', expiresIn: '1h' },
  )}`,
});

beforeEach(() => {
  jest.clearAllMocks();
  fakeCacheStore.clear();
  createdCount = 0;
});

describe('POST /api/remittances idempotency', () => {
  const payload = {
    recipientAddress: RECIPIENT,
    amount: 100,
    fromCurrency: 'USDC',
    toCurrency: 'USDC',
  };

  it('creates exactly one remittance for two identical requests sharing an Idempotency-Key', async () => {
    const idempotencyKey = 'test-idempotency-key-1';

    const first = await request(app)
      .post('/api/remittances')
      .set(bearer(SENDER))
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(first.status).toBe(201);
    expect(first.headers['x-idempotent-replayed']).toBe('false');

    const second = await request(app)
      .post('/api/remittances')
      .set(bearer(SENDER))
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(second.status).toBe(201);
    expect(second.headers['x-idempotent-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);

    // The underlying service — and therefore the DB insert — only ran once.
    expect(mockCreateRemittance).toHaveBeenCalledTimes(1);
  });

  it('rejects reusing an Idempotency-Key for a different request (different body)', async () => {
    const idempotencyKey = 'cross-endpoint-reuse-key';

    const first = await request(app)
      .post('/api/remittances')
      .set(bearer(SENDER))
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(first.status).toBe(201);

    // Same key but a different body — the cached fingerprint no longer matches,
    // so the key must NOT replay the first response.
    const second = await request(app)
      .post('/api/remittances')
      .set(bearer(SENDER))
      .set('Idempotency-Key', idempotencyKey)
      .send({ ...payload, amount: 999 });

    expect(second.status).toBe(409);
    expect(mockCreateRemittance).toHaveBeenCalledTimes(1);
  });

  it('returns 409 for a concurrent duplicate while the first is still in flight', async () => {
    const idempotencyKey = 'concurrent-key';

    const [first, second] = await Promise.all([
      request(app)
        .post('/api/remittances')
        .set(bearer(SENDER))
        .set('Idempotency-Key', idempotencyKey)
        .send(payload),
      request(app)
        .post('/api/remittances')
        .set(bearer(SENDER))
        .set('Idempotency-Key', idempotencyKey)
        .send(payload),
    ]);

    // Exactly one request wins the in-flight reservation; the concurrent
    // duplicate is rejected with 409 instead of double-executing.
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);
    expect(mockCreateRemittance).toHaveBeenCalledTimes(1);
  });

  it('creates a new remittance per request when no Idempotency-Key is supplied', async () => {
    await request(app).post('/api/remittances').set(bearer(SENDER)).send(payload);
    await request(app).post('/api/remittances').set(bearer(SENDER)).send(payload);

    expect(mockCreateRemittance).toHaveBeenCalledTimes(2);
  });
});
