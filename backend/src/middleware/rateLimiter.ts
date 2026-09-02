import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createClient } from 'redis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
let redisClient: ReturnType<typeof createClient> | undefined;

function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({ url: REDIS_URL });
    redisClient.on('error', () => {});
  }
  return redisClient;
}

function createRedisStore(
  prefix: string,
): { store: RedisStore; passOnStoreError: boolean } | Record<string, never> {
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined) {
    return {};
  }
  try {
    const client = getRedisClient();
    return {
      store: new RedisStore({
        sendCommand: async (...args: string[]) => {
          try {
            if (!client.isOpen) {
              await client.connect();
            }
            return await (client as any).sendCommand(args);
          } catch {
            return undefined;
          }
        },
        prefix: `rl:${prefix}:`,
      }),
      passOnStoreError: true,
    };
  } catch {
    return {};
  }
}

export const createRateLimiter = (max: number, windowMinutes: number = 15, prefix = 'general') =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    ...createRedisStore(prefix),
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

export const globalRateLimiter = createRateLimiter(100, 15, 'global');
export const strictRateLimiter = createRateLimiter(10, 45, 'strict');

// Auth endpoints: 10 req/min per IP (stricter rate limiting for brute-force protection)
export const challengeRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  ...createRedisStore('challenge'),
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
});

export const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  ...createRedisStore('login'),
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
});

export const ipLoginRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  ...createRedisStore('ip-login'),
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
});

export const verifyRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  ...createRedisStore('verify'),
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
  message: { success: false, message: 'Too many verification attempts' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res, _next, options) => {
    res.setHeader('Retry-After', Math.ceil(options.windowMs / 1000));
    res.status(429).json(options.message);
  },
});

// Simulation endpoints: 5 req/min per authenticated user
export const simulationRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  ...createRedisStore('simulation'),
  keyGenerator: (req) => {
    // Use authenticated user's public key if available, otherwise fall back to IP
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
});
