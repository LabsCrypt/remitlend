import { describe, it, expect, jest, beforeAll, afterEach } from '@jest/globals';
import express, { type Express } from 'express';
import request from 'supertest';

const mockLoggerError = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerInfo = jest.fn();
const mockLoggerDebug = jest.fn();

const mockLogger = {
  info: mockLoggerInfo,
  warn: mockLoggerWarn,
  error: mockLoggerError,
  debug: mockLoggerDebug,
  withContext: () => mockLogger,
};

jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: mockLogger,
}));

const mockOn = jest.fn();
const mockConnect = jest.fn<() => Promise<void>>();
const mockSendCommand = jest.fn<(...args: string[]) => Promise<unknown>>();

jest.unstable_mockModule('redis', () => ({
  createClient: () => ({
    on: mockOn,
    connect: mockConnect,
    sendCommand: mockSendCommand,
    isOpen: false,
  }),
}));

const {
  createRateLimiter,
  challengeRateLimiter,
  loginRateLimiter,
  ipLoginRateLimiter,
  verifyRateLimiter,
} = await import('../rateLimiter.js');

const originalNodeEnv = process.env.NODE_ENV;
const originalJestWorkerId = process.env.JEST_WORKER_ID;

let errorHandler: ((err: Error) => void) | undefined;

describe('rateLimiter Redis client error handling (#1852)', () => {
  beforeAll(() => {
    // The store (and thus the Redis client) is only built outside the test env,
    // so emulate a dev environment while creating a limiter once. The module
    // caches the client, so the handler is captured a single time.
    // Return a plausible SCRIPT LOAD reply so the store initializes quietly.
    mockSendCommand.mockResolvedValue('mock-sha');
    delete process.env.JEST_WORKER_ID;
    process.env.NODE_ENV = 'development';
    createRateLimiter(5, 1, 'error-handler-test');

    const errorCall = mockOn.mock.calls.find(([event]) => event === 'error');
    if (!errorCall) {
      throw new Error("Redis client 'error' handler was not registered");
    }
    errorHandler = errorCall[1] as (err: Error) => void;
  });

  afterEach(() => {
    mockLoggerError.mockClear();
    mockLoggerWarn.mockClear();
    mockLoggerInfo.mockClear();
    mockLoggerDebug.mockClear();
    process.env.NODE_ENV = originalNodeEnv;
    if (originalJestWorkerId !== undefined) {
      process.env.JEST_WORKER_ID = originalJestWorkerId;
    } else {
      delete process.env.JEST_WORKER_ID;
    }
  });

  it('registers an error handler on the Redis client', () => {
    expect(errorHandler).toEqual(expect.any(Function));
  });

  it('logs when the Redis client emits an error outside the test environment', () => {
    process.env.NODE_ENV = 'development';
    errorHandler!(new Error('Redis connection failed'));

    expect(mockLoggerError).toHaveBeenCalledWith('Rate limiter Redis client error', {
      error: expect.any(Error),
    });
  });

  it('stays silent in the test environment to keep test output clean', () => {
    process.env.NODE_ENV = 'test';
    errorHandler!(new Error('Redis connection failed'));

    expect(mockLoggerError).not.toHaveBeenCalled();
  });
});

describe('distributed counters, key isolation, and reset headers (#2091)', () => {
  const WINDOW_MS = 60_000;
  let clock = Date.UTC(2026, 5, 1);
  const nowSpy = jest.spyOn(Date, 'now');

  const buildTestApp = (): Express => {
    const app = express();
    app.set('trust proxy', 'loopback');
    app.use(express.json());

    app.post('/test/login', loginRateLimiter, (_req, res) => {
      res.json({ ok: true });
    });
    app.post('/test/ip-login', ipLoginRateLimiter, (_req, res) => {
      res.json({ ok: true });
    });
    app.post('/test/challenge', challengeRateLimiter, (_req, res) => {
      res.json({ ok: true });
    });
    app.post('/test/verify', verifyRateLimiter, (_req, res) => {
      res.json({ ok: true });
    });

    return app;
  };

  const app = buildTestApp();

  beforeEach(() => {
    clock += WINDOW_MS * 10;
    nowSpy.mockImplementation(() => clock);
  });

  afterEach(() => {
    nowSpy.mockReset();
  });

  describe('key isolation across endpoints and identity dimensions', () => {
    it('loginRateLimiter compound key isolates distinct publicKeys on the same IP', async () => {
      const ip = '198.51.100.22';

      // User A makes 5 requests from ip
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/test/login')
          .set('X-Forwarded-For', ip)
          .send({ publicKey: 'G_ALICE' });
        expect(res.status).toBe(200);
      }

      // User A 6th request is blocked (429)
      const blockedA = await request(app)
        .post('/test/login')
        .set('X-Forwarded-For', ip)
        .send({ publicKey: 'G_ALICE' });
      expect(blockedA.status).toBe(429);
      expect(blockedA.headers['retry-after']).toBe('60');
      expect(blockedA.body).toEqual({
        success: false,
        message: 'Too many login attempts, please try again later.',
      });

      // User B from same IP is NOT blocked because key is compound (ip:publicKey)
      const resB = await request(app)
        .post('/test/login')
        .set('X-Forwarded-For', ip)
        .send({ publicKey: 'G_BOB' });
      expect(resB.status).toBe(200);
    });

    it('ipLoginRateLimiter enforces aggregate limit per IP regardless of publicKey', async () => {
      const ip = '198.51.100.33';

      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/test/ip-login')
          .set('X-Forwarded-For', ip)
          .send({ publicKey: `G_ACCOUNT_${i}` });
        expect(res.status).toBe(200);
      }

      const blocked = await request(app)
        .post('/test/ip-login')
        .set('X-Forwarded-For', ip)
        .send({ publicKey: 'G_FRESH_ACCOUNT' });
      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toBe('60');
      expect(blocked.body).toEqual({
        success: false,
        message: 'Too many login attempts from this IP, please try again later.',
      });
    });
  });

  describe('reset and retry-after header contracts', () => {
    it('challengeRateLimiter sets standard headers and Retry-After upon exhaustion', async () => {
      const ip = '198.51.100.44';

      for (let i = 0; i < 10; i++) {
        const res = await request(app)
          .post('/test/challenge')
          .set('X-Forwarded-For', ip)
          .send({ publicKey: 'G_CHALLENGE_USER' });
        expect(res.status).toBe(200);
        expect(res.headers['ratelimit-remaining']).toBe(String(10 - (i + 1)));
      }

      const blocked = await request(app)
        .post('/test/challenge')
        .set('X-Forwarded-For', ip)
        .send({ publicKey: 'G_CHALLENGE_USER' });
      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toBe('60');
      expect(blocked.body).toEqual({
        success: false,
        message: 'Too many challenge requests, please try again later.',
      });
    });

    it('verifyRateLimiter sets Retry-After on 429 response', async () => {
      const ip = '198.51.100.55';

      for (let i = 0; i < 10; i++) {
        const res = await request(app).post('/test/verify').set('X-Forwarded-For', ip).send({});
        expect(res.status).toBe(200);
      }

      const blocked = await request(app).post('/test/verify').set('X-Forwarded-For', ip).send({});
      expect(blocked.status).toBe(429);
      expect(blocked.headers['retry-after']).toBe('60');
      expect(blocked.body).toEqual({
        success: false,
        message: 'Too many verification attempts',
      });
    });
  });

  describe('Redis outages and fail-open resilience in production mode', () => {
    it('fails open when Redis sendCommand rejects or times out', async () => {
      delete (process.env as Record<string, string | undefined>).JEST_WORKER_ID;
      process.env.NODE_ENV = 'development';

      mockSendCommand.mockRejectedValue(new Error('ETIMEDOUT: Redis node unreachable'));

      const resilientLimiter = createRateLimiter(1, 1, 'resilience-test');
      const testApp = express();
      testApp.set('trust proxy', 'loopback');
      testApp.get('/test/resilience', resilientLimiter, (_req, res) => {
        res.json({ success: true });
      });

      const res = await request(testApp)
        .get('/test/resilience')
        .set('X-Forwarded-For', '10.200.1.1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });
  });
});
