import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import request from 'supertest';

// Set NODE_ENV to test to avoid production checks
process.env.NODE_ENV = 'test';

process.env.JWT_SECRET = 'user-profile-test-secret';

const queryMock = jest.fn<
  () => Promise<{
    rows: unknown[];
    rowCount: number;
    command: string;
    oid: number;
    fields: unknown[];
  }>
>();

jest.unstable_mockModule('../db/connection.js', () => ({
  default: {
    query: queryMock,
  },
  pool: {
    query: queryMock,
  },
  query: queryMock,
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

const publicKey = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

function bearerToken() {
  return jwt.sign(
    {
      publicKey,
      role: 'borrower',
      scopes: ['read:profile', 'write:profile'],
    },
    process.env.JWT_SECRET!,
    { expiresIn: '1h', algorithm: 'HS256' },
  );
}

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 12,
    public_key: publicKey,
    display_name: null,
    email: null,
    phone: null,
    email_enabled: false,
    sms_enabled: false,
    metadata: {},
    created_at: '2026-05-27T00:00:00.000Z',
    updated_at: '2026-05-27T00:00:00.000Z',
    ...overrides,
  };
}

describe('/user/profile', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("returns the authenticated user's profile and creates an empty row on first call", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [profileRow()],
      rowCount: 1,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });

    const response = await request(app)
      .get('/user/profile')
      .set('Authorization', `Bearer ${bearerToken()}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: '12',
      email: '',
      walletAddress: publicKey,
      kycVerified: false,
      displayName: '',
      phone: '',
    });
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO user_profiles'), [
      publicKey,
    ]);
  });

  it('updates allowed profile fields after validation', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [profileRow({ metadata: { kycVerified: true } })],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      })
      .mockResolvedValueOnce({
        rows: [
          profileRow({
            display_name: 'Ada Lovelace',
            email: 'ada@example.com',
            phone: '+15551234567',
            metadata: {
              kycVerified: true,
              locale: 'en-US',
              avatarUrl: 'https://example.com/avatar.png',
            },
          }),
        ],
        rowCount: 1,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

    const response = await request(app)
      .patch('/user/profile')
      .set('Authorization', `Bearer ${bearerToken()}`)
      .send({
        displayName: 'Ada Lovelace',
        email: 'ada@example.com',
        phone: '+15551234567',
        locale: 'en-US',
        avatarUrl: 'https://example.com/avatar.png',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      email: 'ada@example.com',
      walletAddress: publicKey,
      kycVerified: true,
      displayName: 'Ada Lovelace',
      phone: '+15551234567',
      locale: 'en-US',
      avatarUrl: 'https://example.com/avatar.png',
    });
    expect(queryMock).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE user_profiles'),
      expect.arrayContaining(['Ada Lovelace', 'ada@example.com', '+15551234567', publicKey]),
    );
  });

  it('rejects invalid patch payloads', async () => {
    const response = await request(app)
      .patch('/user/profile')
      .set('Authorization', `Bearer ${bearerToken()}`)
      .send({ email: 'not-an-email' });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Validation failed');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests', async () => {
    const response = await request(app).get('/user/profile');

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
