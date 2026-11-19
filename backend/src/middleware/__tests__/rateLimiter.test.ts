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

const { createRateLimiter } = await import('../rateLimiter.js');

const buildApp = (limiter: RateLimitRequestHandler): express.Express => {
  const app = express();
  app.get('/limited', limiter, (_req, res) => {
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

describe('rate limiter store failures', () => {
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
