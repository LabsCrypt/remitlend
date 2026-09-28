import { describe, it, expect, beforeEach, beforeAll, jest } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Keypair } from '@stellar/stellar-sdk';

process.env.JWT_SECRET = 'pause-guard-scoping-secret-key-12345';

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
  query: queryMock,
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

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
    healthCheck: jest
      .fn<() => Promise<{ connected: boolean; latestLedger: number }>>()
      .mockResolvedValue({
        connected: true,
        latestLedger: 1000,
      }),
  },
}));

const { default: app } = await import('../app.js');
const { setPauseState, getCurrentPauseState } = await import('../middleware/pauseGuard.js');

describe('pauseGuard Route Scoping (#1866)', () => {
  const keypair = Keypair.random();
  const publicKey = keypair.publicKey();

  function generateBearerToken(scopes: string[] = ['read:profile', 'write:profile']) {
    return jwt.sign(
      {
        publicKey,
        role: 'borrower',
        scopes,
      },
      process.env.JWT_SECRET!,
      { expiresIn: '1h', algorithm: 'HS256' },
    );
  }

  function mockProfileRow() {
    return {
      id: '1',
      public_key: publicKey,
      display_name: 'Test Borrower',
      email: 'borrower@example.com',
      phone: '+15555555555',
      email_enabled: true,
      sms_enabled: false,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  beforeAll(async () => {
    queryMock.mockResolvedValue({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    queryMock.mockResolvedValue({
      rows: [],
      rowCount: 0,
      command: 'SELECT',
      oid: 0,
      fields: [],
    });
    // Reset pause state to not paused before each test
    await setPauseState(false, []);
    jest.clearAllMocks();
  });

  describe('when global contract pause is ACTIVE', () => {
    beforeEach(async () => {
      // Simulate emergency contract pause on lending pool and loan manager
      await setPauseState(
        true,
        ['CONTRACT_LOAN_MANAGER', 'CONTRACT_LENDING_POOL'],
        'Emergency security incident',
      );
      expect(getCurrentPauseState().isPaused).toBe(true);
      jest.clearAllMocks();
    });

    it('allows POST /api/auth/login and /challenge to succeed while contract pause is active', async () => {
      const challengeRes = await request(app)
        .post('/api/auth/challenge')
        .send({ publicKey })
        .expect(200);

      expect(challengeRes.body.success).toBe(true);
      const message = challengeRes.body.data.message;
      const signature = keypair.sign(Buffer.from(message, 'utf-8')).toString('base64');

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          publicKey,
          message,
          signature,
        })
        .expect(200);

      expect(loginRes.body.success).toBe(true);
      expect(loginRes.body.data.token).toBeDefined();
    });

    it('allows PATCH /user/profile to succeed while contract pause is active', async () => {
      queryMock
        .mockResolvedValueOnce({
          rows: [mockProfileRow()],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              ...mockProfileRow(),
              display_name: 'Updated Name',
              email: 'updated@example.com',
            },
          ],
          rowCount: 1,
          command: 'UPDATE',
          oid: 0,
          fields: [],
        });

      const response = await request(app)
        .patch('/user/profile')
        .set('Authorization', `Bearer ${generateBearerToken()}`)
        .send({
          displayName: 'Updated Name',
          email: 'updated@example.com',
        })
        .expect(200);

      expect(response.body.email).toBe('updated@example.com');
      expect(response.body.displayName).toBe('Updated Name');
    });

    it('blocks mutating requests to scoped contract route POST /api/loans with 503', async () => {
      const response = await request(app)
        .post('/api/loans/repay')
        .send({ loanId: 'loan-123', amount: 100 })
        .expect(503);

      expect(response.body.message).toContain('Contract operations are temporarily paused');
      expect(response.body.message).toContain('Emergency security incident');
      expect(response.body.message).toContain('CONTRACT_LOAN_MANAGER');
    });

    it('blocks mutating requests to versioned contract route POST /api/v1/loans with 503', async () => {
      const response = await request(app)
        .post('/api/v1/loans/repay')
        .send({ loanId: 'loan-123', amount: 100 })
        .expect(503);

      expect(response.body.message).toContain('Contract operations are temporarily paused');
    });

    it('blocks mutating requests to contract route POST /api/pool with 503', async () => {
      const response = await request(app)
        .post('/api/pool/deposit')
        .send({ amount: 500 })
        .expect(503);

      expect(response.body.message).toContain('Contract operations are temporarily paused');
    });

    it('blocks mutating requests to contract route POST /api/remittances with 503', async () => {
      const response = await request(app)
        .post('/api/remittances')
        .send({ recipient: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', amount: 50 })
        .expect(503);

      expect(response.body.message).toContain('Contract operations are temporarily paused');
    });

    it('allows read-only GET requests to contract routes through even while paused', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      });

      // GET requests must not be blocked by pauseGuard
      const response = await request(app)
        .get('/api/loans')
        .set('Authorization', `Bearer ${generateBearerToken(['read:loans'])}`);

      // Status should be 200 or 401/404, but definitely NOT 503
      expect(response.status).not.toBe(503);
    });
  });

  describe('when global contract pause is INACTIVE', () => {
    it('allows requests through to contract routes without 503 pause error', async () => {
      expect(getCurrentPauseState().isPaused).toBe(false);

      const response = await request(app)
        .post('/api/loans/repay')
        .send({ loanId: 'loan-123', amount: 100 });

      // When unpaused, request proceeds to auth/validation handlers (not 503)
      expect(response.status).not.toBe(503);
    });
  });
});
