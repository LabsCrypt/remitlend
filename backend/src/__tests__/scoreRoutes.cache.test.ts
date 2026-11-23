/**
 * Cache consistency coverage for scoreRoutes (#2103).
 *
 * The router runs against an in-memory scores table and an in-memory cache so
 * each test can assert exactly what was cached, served from cache, and
 * invalidated after a repayment-driven score update.
 */
import express, { type Express } from 'express';
import request from 'supertest';
import { describe, it, expect, jest, beforeEach, afterAll } from '@jest/globals';

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
process.env.INTERNAL_API_KEY = 'admin:loans:loans-value,admin:indexer:indexer-value';

type QueryResult = { rows: Record<string, unknown>[]; rowCount?: number };

const scoresTable = new Map<string, number>();
const mockQuery = jest.fn<(text: string, params?: unknown[]) => Promise<QueryResult>>();

jest.unstable_mockModule('../db/connection.js', () => ({
  withAdvisoryLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  query: mockQuery,
  getClient: jest.fn(),
  withTransaction: jest.fn(),
  default: { query: mockQuery },
}));

const cacheStore = new Map<string, unknown>();
const cacheTtls = new Map<string, number | undefined>();
const mockCache = {
  get: jest.fn(async (key: string) => cacheStore.get(key) ?? null),
  set: jest.fn(async (key: string, value: unknown, ttl?: number) => {
    cacheStore.set(key, value);
    cacheTtls.set(key, ttl);
  }),
  delete: jest.fn(async (key: string) => {
    cacheStore.delete(key);
  }),
  ping: jest.fn(async () => 'ok'),
};
jest.unstable_mockModule('../services/cacheService.js', () => ({ cacheService: mockCache }));

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetTime: Date;
  currentCount: number;
};
const mockCheckRateLimit = jest.fn<() => Promise<RateLimitResult>>();
jest.unstable_mockModule('../services/rateLimitService.js', () => ({
  rateLimitService: { checkRateLimit: mockCheckRateLimit },
  SCORE_UPDATE_RATE_LIMIT: { maxRequests: 5, windowSeconds: 86_400 },
}));

const { default: scoreRoutes } = await import('../routes/scoreRoutes.js');
const { errorHandler } = await import('../middleware/errorHandler.js');
const { generateJwtToken } = await import('../services/authService.js');

const USER = 'GSCORECACHEUSER';
const OTHER = 'GSCORECACHEOTHER';

const buildApp = (): Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/score', scoreRoutes);
  app.use(errorHandler);
  return app;
};

const app = buildApp();

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

const getScore = (userId: string) => request(app).get(`/api/score/${userId}`).set(bearer(userId));

const postUpdate = (body: Record<string, unknown>, apiKey = 'loans-value') =>
  request(app).post('/api/score/update').set('x-api-key', apiKey).send(body);

const scoreReads = () => mockQuery.mock.calls.filter(([text]) => text.startsWith('SELECT score'));

beforeEach(() => {
  scoresTable.clear();
  cacheStore.clear();
  cacheTtls.clear();
  mockQuery.mockReset();
  mockQuery.mockImplementation(async (text: string, params: unknown[] = []) => {
    const userId = params[0] as string;
    if (text.startsWith('SELECT score')) {
      return scoresTable.has(userId)
        ? { rows: [{ score: scoresTable.get(userId) }] }
        : { rows: [] };
    }
    if (text.includes('INSERT INTO scores')) {
      const delta = params[2] as number;
      const next = scoresTable.has(userId)
        ? Math.min(850, Math.max(300, scoresTable.get(userId)! + delta))
        : (params[1] as number);
      scoresTable.set(userId, next);
      return { rows: [{ score: next }] };
    }
    return { rows: [] };
  });
  mockCache.get.mockClear();
  mockCache.set.mockClear();
  mockCache.delete.mockClear();
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 4,
    resetTime: new Date(Date.UTC(2026, 9, 23)),
    currentCount: 1,
  });
});

afterAll(() => {
  delete process.env.JWT_SECRET;
  delete process.env.INTERNAL_API_KEY;
});

describe('GET /api/score/:userId caching', () => {
  it('caches a miss for 5 minutes and serves the next read from cache', async () => {
    scoresTable.set(USER, 700);

    const first = await getScore(USER);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ success: true, userId: USER, score: 700, band: 'Good' });
    expect(cacheStore.get(`score:userId:${USER}`)).toEqual({ score: 700, band: 'Good' });
    expect(cacheTtls.get(`score:userId:${USER}`)).toBe(300);

    // A DB change without invalidation must not leak through the cache.
    scoresTable.set(USER, 800);
    const second = await getScore(USER);
    expect(second.body.score).toBe(700);
    expect(scoreReads()).toHaveLength(1);
  });

  it('caches the 500 default for a user with no score row', async () => {
    const res = await getScore(USER);

    expect(res.body).toMatchObject({ score: 500, band: 'Poor' });
    expect(cacheStore.get(`score:userId:${USER}`)).toEqual({ score: 500, band: 'Poor' });
  });

  it('returns the same response shape on a cache hit as on a miss', async () => {
    scoresTable.set(USER, 760);

    const miss = await getScore(USER);
    const hit = await getScore(USER);

    expect(hit.body).toEqual(miss.body);
  });

  it('does not read or populate the cache for a mismatched wallet', async () => {
    const res = await request(app).get(`/api/score/${OTHER}`).set(bearer(USER));

    expect(res.status).toBe(403);
    // The only cache read allowed is the JWT revocation lookup.
    expect(mockCache.get).not.toHaveBeenCalledWith(expect.stringMatching(/^score:/));
    expect(mockCache.set).not.toHaveBeenCalled();
  });

  it('requires a JWT', async () => {
    const res = await request(app).get(`/api/score/${USER}`);

    expect(res.status).toBe(401);
    expect(mockCache.get).not.toHaveBeenCalled();
  });
});

describe('POST /api/score/update cache invalidation', () => {
  it('invalidates the cached score so the next read reflects the repayment', async () => {
    scoresTable.set(USER, 700);
    await getScore(USER);

    const update = await postUpdate({ userId: USER, repaymentAmount: 100, onTime: true });
    expect(update.status).toBe(200);
    expect(update.body).toMatchObject({ oldScore: 700, delta: 15, newScore: 715, band: 'Good' });
    expect(cacheStore.has(`score:userId:${USER}`)).toBe(false);

    const after = await getScore(USER);
    expect(after.body.score).toBe(715);
    expect(cacheStore.get(`score:userId:${USER}`)).toEqual({ score: 715, band: 'Good' });
  });

  it('invalidates the cached breakdown alongside the score', async () => {
    cacheStore.set(`score:breakdown:${USER}`, { userId: USER, score: 700 });

    const res = await postUpdate({ userId: USER, repaymentAmount: 100, onTime: false });

    expect(res.status).toBe(200);
    expect(cacheStore.has(`score:breakdown:${USER}`)).toBe(false);
    expect(mockCache.delete).toHaveBeenCalledWith(`score:userId:${USER}`);
    expect(mockCache.delete).toHaveBeenCalledWith(`score:breakdown:${USER}`);
  });

  it("leaves other users' cache entries untouched", async () => {
    scoresTable.set(OTHER, 650);
    await getScore(OTHER);

    await postUpdate({ userId: USER, repaymentAmount: 100, onTime: true });

    expect(cacheStore.get(`score:userId:${OTHER}`)).toEqual({ score: 650, band: 'Fair' });
  });

  it('clamps at 850 and caches the clamped score on the next read', async () => {
    scoresTable.set(USER, 845);

    const res = await postUpdate({ userId: USER, repaymentAmount: 100, onTime: true });
    expect(res.body).toMatchObject({ newScore: 850, band: 'Excellent' });

    const after = await getScore(USER);
    expect(after.body).toMatchObject({ score: 850, band: 'Excellent' });
  });

  it('keeps the cached score when the write fails', async () => {
    scoresTable.set(USER, 700);
    await getScore(USER);
    mockQuery.mockImplementation(async (text: string) => {
      if (text.includes('INSERT INTO scores')) throw new Error('db down');
      return { rows: [{ score: 700 }] };
    });

    const res = await postUpdate({ userId: USER, repaymentAmount: 100, onTime: true });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(cacheStore.get(`score:userId:${USER}`)).toEqual({ score: 700, band: 'Good' });
  });

  it.each([
    ['negative amount', { userId: USER, repaymentAmount: -1, onTime: true }],
    ['amount over the limit', { userId: USER, repaymentAmount: 1_000_001, onTime: true }],
    ['non-boolean onTime', { userId: USER, repaymentAmount: 100, onTime: 'yes' }],
    ['userId over 100 chars', { userId: 'G'.repeat(101), repaymentAmount: 100, onTime: true }],
  ])('rejects %s with 400 and no invalidation', async (_label, body) => {
    const res = await postUpdate(body);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockCache.delete).not.toHaveBeenCalled();
  });

  it('returns 429 without touching the cache when the update budget is spent', async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetTime: new Date(Date.UTC(2026, 9, 23)),
      currentCount: 5,
    });

    const res = await postUpdate({ userId: USER, repaymentAmount: 100, onTime: true });

    expect(res.status).toBe(429);
    expect(res.body.message).toBe(
      'Too many score updates. Maximum 5 updates allowed per user per day.',
    );
    expect(res.headers['x-ratelimit-remaining']).toBe('0');
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockCache.delete).not.toHaveBeenCalled();
  });

  it('requires an API key', async () => {
    const res = await request(app)
      .post('/api/score/update')
      .send({ userId: USER, repaymentAmount: 100, onTime: true });

    expect(res.status).toBe(401);
    expect(mockCache.delete).not.toHaveBeenCalled();
  });

  it('rejects a key without the admin:loans scope', async () => {
    const res = await postUpdate(
      { userId: USER, repaymentAmount: 100, onTime: true },
      'indexer-value',
    );

    expect(res.status).toBe(403);
    expect(mockCache.delete).not.toHaveBeenCalled();
  });
});

describe('GET /api/score/:userId/breakdown caching', () => {
  it('serves a cached breakdown without querying the database', async () => {
    cacheStore.set(`score:breakdown:${USER}`, { userId: USER, score: 640, band: 'Fair' });

    const res = await request(app).get(`/api/score/${USER}/breakdown`).set(bearer(USER));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, userId: USER, score: 640, band: 'Fair' });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
