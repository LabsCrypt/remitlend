import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockConnect = jest.fn<() => Promise<void>>();
const mockOn = jest.fn();
const mockIncr = jest.fn<(key: string) => Promise<number>>();
const mockExpire = jest.fn<(key: string, seconds: number) => Promise<boolean>>();
const mockTtl = jest.fn<(key: string) => Promise<number>>();
const mockGet = jest.fn<(key: string) => Promise<string | null>>();
const mockDel = jest.fn<(key: string) => Promise<number>>();

jest.unstable_mockModule('redis', () => ({
  createClient: () => ({
    connect: mockConnect,
    on: mockOn,
    incr: mockIncr,
    expire: mockExpire,
    ttl: mockTtl,
    get: mockGet,
    del: mockDel,
  }),
}));

const { rateLimitService, SCORE_UPDATE_RATE_LIMIT } = await import('../rateLimitService.js');

describe('rateLimitService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockExpire.mockResolvedValue(true);
    mockTtl.mockResolvedValue(60);
    mockGet.mockResolvedValue(null);
    mockDel.mockResolvedValue(1);
  });

  it('allows the first request and creates the rate-limit window', async () => {
    mockIncr.mockResolvedValueOnce(1);

    const result = await rateLimitService.checkRateLimit('user123', SCORE_UPDATE_RATE_LIMIT);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.currentCount).toBe(1);
    expect(mockIncr).toHaveBeenCalledWith('rate_limit:user123');
    expect(mockExpire).toHaveBeenCalledWith('rate_limit:user123', 86400);
  });

  it('blocks requests once the atomic counter exceeds the limit', async () => {
    mockIncr.mockResolvedValueOnce(6);

    const result = await rateLimitService.checkRateLimit('user123', SCORE_UPDATE_RATE_LIMIT);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.currentCount).toBe(6);
  });

  it('admits at most maxRequests under concurrent requests', async () => {
    let counter = 0;
    mockIncr.mockImplementation(async () => {
      counter += 1;
      return counter;
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        rateLimitService.checkRateLimit('score:user1', {
          maxRequests: 5,
          windowSeconds: 60,
        }),
      ),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    expect(results.filter((result) => !result.allowed)).toHaveLength(5);
    expect(mockIncr).toHaveBeenCalledTimes(10);
  });

  it('preserves fail-open behavior when Redis is unavailable', async () => {
    mockIncr.mockRejectedValueOnce(new Error('Redis connection failed'));

    const result = await rateLimitService.checkRateLimit('user123', SCORE_UPDATE_RATE_LIMIT);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.currentCount).toBe(1);
  });

  it('resets the rate limit counter', async () => {
    await rateLimitService.resetRateLimit('user123');

    expect(mockDel).toHaveBeenCalledWith('rate_limit:user123');
  });

  it('returns current status without incrementing', async () => {
    mockGet.mockResolvedValueOnce('2');
    mockTtl.mockResolvedValueOnce(120);

    const result = await rateLimitService.getRateLimitStatus('user123', SCORE_UPDATE_RATE_LIMIT);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
    expect(mockIncr).not.toHaveBeenCalled();
  });

  it('returns default status for new identifiers', async () => {
    mockGet.mockResolvedValueOnce(null);

    const result = await rateLimitService.getRateLimitStatus('user123', SCORE_UPDATE_RATE_LIMIT);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5);
  });
});
