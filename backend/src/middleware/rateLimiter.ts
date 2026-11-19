import rateLimit, {
  ipKeyGenerator,
  type Options,
  type RateLimitRequestHandler,
  type Store,
} from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { createClient } from 'redis';
import logger from '../utils/logger.js';
import { Sentry } from '../config/sentry.js';

type RedisClientLike = {
  isOpen: boolean;
  connect: () => Promise<unknown>;
  sendCommand: (args: string[]) => Promise<unknown>;
  on: (event: string, listener: (error: Error) => void) => unknown;
};

type DegradationReason =
  'missing-redis-url' | 'store-construction-failed' | 'redis-client-error' | 'store-command-failed';

export interface RateLimiterDegradation {
  prefix: string;
  reason: DegradationReason;
  error?: unknown;
}

export interface RateLimiterDependencies {
  createRedisClient?: () => RedisClientLike;
  createFallbackStore?: (windowMs: number) => Store;
  onDegraded?: (details: RateLimiterDegradation) => void;
  store?: Store;
}

const reportedDegradations = new Set<string>();
const rateLimitLogger = {
  error: (error: unknown, message?: string) => {
    logger.withContext().error(message ?? 'Rate limiter error', { error });
  },
  warn: (warning: unknown, message?: string) => {
    logger.withContext().warn(message ?? 'Rate limiter warning', { warning });
  },
};

class LocalRateLimitStore implements Store {
  private readonly hits = new Map<string, { totalHits: number; resetTime: number }>();

  constructor(private readonly windowMs: number) {}

  async increment(key: string) {
    const now = Date.now();
    const existing = this.hits.get(key);

    if (!existing || existing.resetTime <= now) {
      const resetTime = now + this.windowMs;
      this.hits.set(key, { totalHits: 1, resetTime });
      return { totalHits: 1, resetTime: new Date(resetTime) };
    }

    const totalHits = existing.totalHits + 1;
    this.hits.set(key, { ...existing, totalHits });
    return { totalHits, resetTime: new Date(existing.resetTime) };
  }

  async decrement(key: string): Promise<void> {
    const existing = this.hits.get(key);
    if (!existing) return;

    if (existing.totalHits <= 1) {
      this.hits.delete(key);
      return;
    }

    this.hits.set(key, { ...existing, totalHits: existing.totalHits - 1 });
  }

  async resetKey(key: string): Promise<void> {
    this.hits.delete(key);
  }

  async resetAll(): Promise<void> {
    this.hits.clear();
  }
}

const reportDegradation = ({ prefix, reason, error }: RateLimiterDegradation): void => {
  const key = reason === 'missing-redis-url' ? reason : `${prefix}:${reason}`;
  if (reportedDegradations.has(key)) return;
  reportedDegradations.add(key);

  logger.withContext().error('Rate limiting degraded', {
    prefix,
    reason,
    error,
    degraded: true,
  });
  Sentry.captureMessage('Rate limiting degraded', {
    level: 'error',
    extra: { prefix, reason },
  });
};

const createRateLimiterLogger = (
  prefix: string,
  onDegraded: (details: RateLimiterDegradation) => void,
) => ({
  error: (error: unknown, message?: string) => {
    onDegraded({ prefix, reason: 'store-command-failed', error });
    rateLimitLogger.error(error, message);
  },
  warn: rateLimitLogger.warn,
});

const createStoreConfig = (
  prefix: string,
  windowMs: number,
  dependencies: RateLimiterDependencies,
) => {
  const onDegraded = dependencies.onDegraded ?? reportDegradation;
  const loggerForLimiter = createRateLimiterLogger(prefix, onDegraded);
  const createFallbackStore =
    dependencies.createFallbackStore ?? ((duration: number) => new LocalRateLimitStore(duration));

  if (dependencies.store) {
    return { store: dependencies.store, passOnStoreError: true, logger: loggerForLimiter };
  }

  if (!dependencies.createRedisClient && !process.env.REDIS_URL) {
    onDegraded({ prefix, reason: 'missing-redis-url' });
    return {
      store: createFallbackStore(windowMs),
      passOnStoreError: false,
      logger: loggerForLimiter,
    };
  }

  try {
    const client = dependencies.createRedisClient
      ? dependencies.createRedisClient()
      : (createClient(
          process.env.REDIS_URL ? { url: process.env.REDIS_URL } : {},
        ) as unknown as RedisClientLike);

    client.on('error', (error) => {
      onDegraded({ prefix, reason: 'redis-client-error', error });
      rateLimitLogger.error(error, 'Rate limiter Redis client error');
    });

    return {
      store: new RedisStore({
        sendCommand: async (...args: string[]) => {
          if (!client.isOpen) {
            await client.connect();
          }
          return (await client.sendCommand(args)) as RedisReply;
        },
        prefix: `rl:${prefix}:`,
      }),
      passOnStoreError: true,
      logger: loggerForLimiter,
    };
  } catch (error) {
    onDegraded({ prefix, reason: 'store-construction-failed', error });
    return {
      store: createFallbackStore(windowMs),
      passOnStoreError: false,
      logger: loggerForLimiter,
    };
  }
};

type RateLimiterConfig = Partial<Omit<Options, 'store' | 'passOnStoreError' | 'logger'>> & {
  max: number;
  windowMs: number;
  prefix: string;
};

const createConfiguredRateLimiter = (
  config: RateLimiterConfig,
  dependencies: RateLimiterDependencies = {},
): RateLimitRequestHandler => {
  const { prefix, ...options } = config;
  return rateLimit({
    ...options,
    ...createStoreConfig(prefix, config.windowMs, dependencies),
  });
};

export const createRateLimiter = (
  max: number,
  windowMinutes: number = 15,
  prefix = 'general',
  dependencies: RateLimiterDependencies = {},
): RateLimitRequestHandler =>
  createConfiguredRateLimiter(
    {
      windowMs: windowMinutes * 60 * 1000,
      max,
      prefix,
      message: { error: 'Too many requests, please try again later.' },
      standardHeaders: true,
      legacyHeaders: false,
    },
    dependencies,
  );

export const createAuthRateLimiters = (dependencies: RateLimiterDependencies = {}) => ({
  challengeRateLimiter: createConfiguredRateLimiter(
    {
      windowMs: 60 * 1000,
      max: 10,
      prefix: 'challenge',
      keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
      message: {
        success: false,
        message: 'Too many challenge requests, please try again later.',
      },
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, res, _next, options) => {
        res.setHeader('Retry-After', Math.ceil(options.windowMs / 1000));
        res.status(429).json(options.message);
      },
    },
    dependencies,
  ),
  loginRateLimiter: createConfiguredRateLimiter(
    {
      windowMs: 60 * 1000,
      max: 5,
      prefix: 'login',
      keyGenerator: (req) =>
        `${ipKeyGenerator(req.ip ?? 'unknown')}:${req.body?.publicKey ?? 'unknown'}`,
      message: {
        success: false,
        message: 'Too many login attempts, please try again later.',
      },
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, res, _next, options) => {
        res.setHeader('Retry-After', Math.ceil(options.windowMs / 1000));
        res.status(429).json(options.message);
      },
    },
    dependencies,
  ),
  ipLoginRateLimiter: createConfiguredRateLimiter(
    {
      windowMs: 60 * 1000,
      max: 5,
      prefix: 'ip-login',
      keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
      message: {
        success: false,
        message: 'Too many login attempts from this IP, please try again later.',
      },
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, res, _next, options) => {
        res.setHeader('Retry-After', Math.ceil(options.windowMs / 1000));
        res.status(429).json(options.message);
      },
    },
    dependencies,
  ),
  verifyRateLimiter: createConfiguredRateLimiter(
    {
      windowMs: 60 * 1000,
      max: 10,
      prefix: 'verify',
      keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
      message: { success: false, message: 'Too many verification attempts' },
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, res, _next, options) => {
        res.setHeader('Retry-After', Math.ceil(options.windowMs / 1000));
        res.status(429).json(options.message);
      },
    },
    dependencies,
  ),
});

export const createSimulationRateLimiter = (dependencies: RateLimiterDependencies = {}) =>
  createConfiguredRateLimiter(
    {
      windowMs: 60 * 1000,
      max: 5,
      prefix: 'simulation',
      keyGenerator: (req) => {
        const user = (req as unknown as { user?: { publicKey: string } }).user;
        return user?.publicKey ?? ipKeyGenerator(req.ip ?? 'unknown');
      },
      message: {
        success: false,
        message: 'Too many simulation requests, please try again later.',
      },
      standardHeaders: true,
      legacyHeaders: false,
      skip: () => process.env.NODE_ENV === 'test',
      handler: (_req, res, _next, options) => {
        res.setHeader('Retry-After', Math.ceil(options.windowMs / 1000));
        res.status(429).json(options.message);
      },
    },
    dependencies,
  );

export const globalRateLimiter = createRateLimiter(100, 15, 'global');
export const strictRateLimiter = createRateLimiter(10, 45, 'strict');
export const { challengeRateLimiter, loginRateLimiter, ipLoginRateLimiter, verifyRateLimiter } =
  createAuthRateLimiters();
export const simulationRateLimiter = createSimulationRateLimiter();
