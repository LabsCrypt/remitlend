import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { RateLimitRequestHandler } from 'express-rate-limit';

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

const mockCaptureMessage = jest.fn();
jest.unstable_mockModule('../../config/sentry.js', () => ({
  Sentry: { captureMessage: mockCaptureMessage },
}));

const { createRateLimiter, createAuthRateLimiters } = await import('../rateLimiter.js');

const buildApp = (
  limiter: RateLimitRequestHandler,
  routePath: string = '/limited',
): express.Express => {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.all(routePath, limiter, (_req, res) => {
    res.json({ ok: true });
  });
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ message: err instanceof Error ? err.message : 'error' });
  });
  return app;
};

const createClientMock = (sendCommand: (args: string[]) => Promise<unknown>) => {
  const mockOn = jest.fn<(event: string, listener: (error: Error) => void) => void>();
  const mockConnect = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const client = {
    isOpen: true,
    connect: mockConnect,
    sendCommand: jest.fn(sendCommand),
    on: mockOn,
  };

  return {
    client,
    mockOn,
    mockConnect,
    mockSendCommand: client.sendCommand,
  };
};

describe('rate limiter store failures and redis outages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('propagates store command errors to passOnStoreError and alerts once', async () => {
    const onDegraded = jest.fn();
    const { client, mockSendCommand } = createClientMock(async () => {
      throw new Error('redis command failed');
    });
    const limiter = createRateLimiter(1, 1, 'store-error-test', {
      createRedisClient: () => client,
      onDegraded,
    });

    const response = await request(buildApp(limiter)).get('/limited');

    expect(response.status).toBe(200);
    expect(mockSendCommand).toHaveBeenCalled();
    expect(onDegraded).toHaveBeenCalledWith(
      expect.objectContaining({
        prefix: 'store-error-test',
        reason: 'store-command-failed',
      }),
    );
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.stringContaining('error from store'),
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it('fails open when Redis connection drops and reconnect rejects (outage path)', async () => {
    const onDegraded = jest.fn();
    const connectError = new Error('connect ECONNREFUSED 127.0.0.1:6379');
    const { client, mockConnect } = createClientMock(async () => 'OK');

    client.isOpen = false;
    mockConnect.mockRejectedValue(connectError);

    const limiter = createRateLimiter(1, 1, 'outage-test', {
      createRedisClient: () => client,
      onDegraded,
    });

    const response = await request(buildApp(limiter)).get('/limited');

    // Fail-open contract: request is allowed through rather than failing the caller
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(onDegraded).toHaveBeenCalledWith(
      expect.objectContaining({
        prefix: 'outage-test',
        reason: 'store-command-failed',
      }),
    );
  });

  it('logs and alerts on store construction failure, then uses the fallback store', async () => {
    const onDegraded = jest.fn();
    const constructionError = new Error('client construction failed');
    const limiter = createRateLimiter(2, 1, 'construction-failure-test', {
      createRedisClient: () => {
        throw constructionError;
      },
      onDegraded,
    });

    expect(onDegraded).toHaveBeenCalledWith({
      prefix: 'construction-failure-test',
      reason: 'store-construction-failed',
      error: constructionError,
    });

    const app = buildApp(limiter);
    expect((await request(app).get('/limited')).status).toBe(200);
    expect((await request(app).get('/limited')).status).toBe(200);
    expect((await request(app).get('/limited')).status).toBe(429);
  });

  it('logs and alerts on Redis client errors without a test-environment gate', () => {
    const onDegraded = jest.fn();
    const { client, mockOn } = createClientMock(async () => 'sha');

    createRateLimiter(1, 1, 'client-error-test', {
      createRedisClient: () => client,
      onDegraded,
    });

    const errorCall = mockOn.mock.calls.find(([event]) => event === 'error');
    expect(errorCall).toBeDefined();

    const clientError = new Error('socket failure');
    errorCall?.[1](clientError);

    expect(onDegraded).toHaveBeenCalledWith({
      prefix: 'client-error-test',
      reason: 'redis-client-error',
      error: clientError,
    });
    expect(mockLoggerError).toHaveBeenCalledWith('Rate limiter Redis client error', {
      error: clientError,
    });
  });

  it('uses the Redis store command path when a client is injected', async () => {
    const counts = new Map<string, { hits: number; expiresAt: number }>();
    const { client } = createClientMock(async (args) => {
      const [command, , , key, windowMs] = args;

      if (command === 'SCRIPT') {
        return 'mock-sha';
      }

      if (command === 'EVALSHA' && key && windowMs) {
        const now = Date.now();
        const current = counts.get(key);
        const duration = Number(windowMs);

        if (!current || current.expiresAt <= now) {
          counts.set(key, { hits: 1, expiresAt: now + duration });
          return [1, duration];
        }

        current.hits += 1;
        return [current.hits, current.expiresAt - now];
      }

      return null;
    });

    const limiter = createRateLimiter(2, 1, 'redis-store-test', {
      createRedisClient: () => client,
      onDegraded: jest.fn(),
    });

    const app = buildApp(limiter);
    expect((await request(app).get('/limited')).status).toBe(200);
    expect((await request(app).get('/limited')).status).toBe(200);
    expect((await request(app).get('/limited')).status).toBe(429);
    expect([...counts.values()][0]?.hits).toBe(3);
  });

  it('reports missing Redis configuration as a degraded limiter', () => {
    const onDegraded = jest.fn();
    const originalRedisUrl = process.env.REDIS_URL;
    delete process.env.REDIS_URL;

    try {
      createRateLimiter(5, 1, 'missing-url-test', { onDegraded });
      expect(onDegraded).toHaveBeenCalledWith({
        prefix: 'missing-url-test',
        reason: 'missing-redis-url',
      });
    } finally {
      if (originalRedisUrl === undefined) {
        delete process.env.REDIS_URL;
      } else {
        process.env.REDIS_URL = originalRedisUrl;
      }
    }
  });
});

describe('rate limiter key isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('isolates counters between different client IP addresses', async () => {
    const limiter = createRateLimiter(2, 1, 'ip-isolation-test');
    const app = buildApp(limiter);

    // IP A makes 2 requests (exhausts max: 2)
    const ipA1 = await request(app).get('/limited').set('X-Forwarded-For', '203.0.113.10');
    const ipA2 = await request(app).get('/limited').set('X-Forwarded-For', '203.0.113.10');
    const ipA3 = await request(app).get('/limited').set('X-Forwarded-For', '203.0.113.10');

    expect(ipA1.status).toBe(200);
    expect(ipA2.status).toBe(200);
    expect(ipA3.status).toBe(429);

    // IP B makes a request with fresh quota (not blocked by IP A)
    const ipB1 = await request(app).get('/limited').set('X-Forwarded-For', '203.0.113.20');
    expect(ipB1.status).toBe(200);
  });

  it('isolates counters between different limiter prefixes on the same store', async () => {
    const limiterA = createRateLimiter(1, 1, 'limiter-a');
    const limiterB = createRateLimiter(1, 1, 'limiter-b');

    const app = express();
    app.set('trust proxy', true);
    app.get('/route-a', limiterA, (_req, res) => res.json({ route: 'a' }));
    app.get('/route-b', limiterB, (_req, res) => res.json({ route: 'b' }));

    const clientIp = '198.51.100.5';

    // Route A reaches limit
    expect((await request(app).get('/route-a').set('X-Forwarded-For', clientIp)).status).toBe(200);
    expect((await request(app).get('/route-a').set('X-Forwarded-For', clientIp)).status).toBe(429);

    // Route B is isolated and still succeeds for the same IP
    expect((await request(app).get('/route-b').set('X-Forwarded-For', clientIp)).status).toBe(200);
    expect((await request(app).get('/route-b').set('X-Forwarded-For', clientIp)).status).toBe(429);
  });

  it('isolates loginRateLimiter counters by compound IP:publicKey key', async () => {
    const { loginRateLimiter } = createAuthRateLimiters();
    const app = express();
    app.set('trust proxy', true);
    app.use(express.json());
    app.post('/auth/login', loginRateLimiter, (_req, res) => res.json({ success: true }));

    const clientIp = '198.51.100.99';
    const userA = 'GUSERAAAAA';
    const userB = 'GUSERBBBBB';

    // Exhaust userA's 5 login attempts
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/auth/login')
        .set('X-Forwarded-For', clientIp)
        .send({ publicKey: userA });
      expect(res.status).toBe(200);
    }

    // 6th attempt for userA is rate limited
    const userALimited = await request(app)
      .post('/auth/login')
      .set('X-Forwarded-For', clientIp)
      .send({ publicKey: userA });
    expect(userALimited.status).toBe(429);

    // userB from the SAME IP is isolated and succeeds
    const userBAllowed = await request(app)
      .post('/auth/login')
      .set('X-Forwarded-For', clientIp)
      .send({ publicKey: userB });
    expect(userBAllowed.status).toBe(200);

    // userA from a DIFFERENT IP is isolated and succeeds
    const userADifferentIp = await request(app)
      .post('/auth/login')
      .set('X-Forwarded-For', '198.51.100.100')
      .send({ publicKey: userA });
    expect(userADifferentIp.status).toBe(200);
  });

  it('prefixes RedisStore keys with the limiter prefix', async () => {
    const executedKeys: string[] = [];
    const { client } = createClientMock(async (args) => {
      const [command, , , key] = args;
      if (command === 'SCRIPT') return 'sha';
      if (command === 'EVALSHA' && key) {
        executedKeys.push(key);
        return [1, 60000];
      }
      return null;
    });

    const limiter = createRateLimiter(5, 1, 'tenant-scope', {
      createRedisClient: () => client,
    });

    await request(buildApp(limiter)).get('/limited').set('X-Forwarded-For', '10.0.0.1');

    expect(executedKeys.length).toBeGreaterThan(0);
    expect(executedKeys[0]).toMatch(/^rl:tenant-scope:/);
  });
});

describe('rate limiter reset headers and contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends standard RateLimit headers and decrements remaining quota on allowed requests', async () => {
    const limiter = createRateLimiter(3, 1, 'headers-test');
    const app = buildApp(limiter);

    const res1 = await request(app).get('/limited');
    expect(res1.status).toBe(200);
    expect(res1.headers['ratelimit-limit']).toBe('3');
    expect(res1.headers['ratelimit-remaining']).toBe('2');
    expect(res1.headers['ratelimit-reset']).toBeDefined();
    expect(Number(res1.headers['ratelimit-reset'])).toBeGreaterThan(0);
    // Legacy X-RateLimit headers should NOT be present
    expect(res1.headers['x-ratelimit-limit']).toBeUndefined();

    const res2 = await request(app).get('/limited');
    expect(res2.status).toBe(200);
    expect(res2.headers['ratelimit-remaining']).toBe('1');

    const res3 = await request(app).get('/limited');
    expect(res3.status).toBe(200);
    expect(res3.headers['ratelimit-remaining']).toBe('0');
  });

  it('returns 429 with standard headers and Retry-After on limit exhaustion', async () => {
    const { challengeRateLimiter } = createAuthRateLimiters();
    const app = express();
    app.set('trust proxy', true);
    app.get('/auth/challenge', challengeRateLimiter, (_req, res) => res.json({ ok: true }));

    // challengeRateLimiter has max: 10, windowMs: 60s
    for (let i = 0; i < 10; i++) {
      await request(app).get('/auth/challenge').set('X-Forwarded-For', '12.34.56.78');
    }

    const blockedRes = await request(app)
      .get('/auth/challenge')
      .set('X-Forwarded-For', '12.34.56.78');

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body).toEqual({
      success: false,
      message: 'Too many challenge requests, please try again later.',
    });
    expect(blockedRes.headers['retry-after']).toBe('60');
    expect(blockedRes.headers['ratelimit-remaining']).toBe('0');
    expect(blockedRes.headers['ratelimit-limit']).toBe('10');
  });

  it('resets quota after window expiration allowing subsequent requests', async () => {
    // Window of 100ms for fast deterministic reset test
    const app = express();
    app.set('trust proxy', true);

    const limiter = createRateLimiter(1, 0.002, 'reset-window-test'); // ~120ms
    app.get('/reset-test', limiter, (_req, res) => res.json({ success: true }));

    const clientIp = '55.66.77.88';

    // 1st request -> 200
    const res1 = await request(app).get('/reset-test').set('X-Forwarded-For', clientIp);
    expect(res1.status).toBe(200);

    // 2nd request -> 429
    const res2 = await request(app).get('/reset-test').set('X-Forwarded-For', clientIp);
    expect(res2.status).toBe(429);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    // 3rd request after window expiry -> 200 with reset counter
    const res3 = await request(app).get('/reset-test').set('X-Forwarded-For', clientIp);
    expect(res3.status).toBe(200);
  });
});
