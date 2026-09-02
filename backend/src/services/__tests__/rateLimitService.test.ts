import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockConnect = jest.fn<() => Promise<void>>();
const mockOn = jest.fn();
const mockEval =
  jest.fn<(script: string, options: { keys: string[]; arguments: string[] }) => Promise<unknown>>();
const mockTtl = jest.fn<(key: string) => Promise<number>>();
const mockGet = jest.fn<(key: string) => Promise<string | null>>();
const mockDel = jest.fn<(key: string) => Promise<number>>();

jest.unstable_mockModule('redis', () => ({
  createClient: () => ({
    connect: mockConnect,
    on: mockOn,
    eval: mockEval,
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
    mockEval.mockResolvedValue([1, 60]);
    mockTtl.mockResolvedValue(60);
    mockGet.mockResolvedValue(null);
    mockDel.mockResolvedValue(1);
  });

  it('allows the first request and creates the rate-limit window', async () => {
    mockEval.mockResolvedValueOnce([1, 86400]);

    const result = await rateLimitService.checkRateLimit('user123', SCORE_UPDATE_RATE_LIMIT);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.currentCount).toBe(1);
    expect(mockEval).toHaveBeenCalled();
  });

  it('guarantees the key always has a positive TTL after the first increment', async () => {
    mockEval.mockResolvedValueOnce([1, 86400]);

    const result = await rateLimitService.checkRateLimit('user123', SCORE_UPDATE_RATE_LIMIT);

    expect(result.currentCount).toBe(1);
    expect(mockEval).toHaveBeenCalled();
    const evalCall = mockEval.mock.calls[0];
    const script = evalCall[0] as string;
    expect(script).toContain('INCR');
    expect(script).toContain('EXPIRE');
    expect(script).toContain('TTL');
  });

  it('blocks requests once the atomic counter reaches or exceeds the limit', async () => {
    mockEval.mockResolvedValueOnce([5, 60]);

    const result = await rateLimitService.checkRateLimit('user123', {
      maxRequests: 5,
      windowSeconds: 60,
    });

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.currentCount).toBe(5);
  });

  it('admits requests strictly below maxRequests under concurrent requests', async () => {
    let counter = 0;
    mockEval.mockImplementation(async () => {
      counter += 1;
      return [counter, 60 - counter];
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        rateLimitService.checkRateLimit('score:user1', {
          maxRequests: 5,
          windowSeconds: 60,
        }),
      ),
    );

    expect(results.filter((result) => result.allowed)).toHaveLength(4);
    expect(results.filter((result) => !result.allowed)).toHaveLength(6);
    expect(mockEval).toHaveBeenCalledTimes(10);
  });

  it('preserves fail-open behavior when Redis is unavailable', async () => {
    mockEval.mockRejectedValueOnce(new Error('Redis connection failed'));

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
    expect(mockEval).not.toHaveBeenCalled();
  });

  it('returns default status for new identifiers', async () => {
    mockGet.mockResolvedValueOnce(null);

    const result = await rateLimitService.getRateLimitStatus('user123', SCORE_UPDATE_RATE_LIMIT);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5);
  });
});
