import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
} from "@jest/globals";

let rateLimitService: any;
let SCORE_UPDATE_RATE_LIMIT: any;
let mockCacheService: jest.Mocked<any>;

beforeAll(async () => {
  // Mock the cache service BEFORE importing the module under test
  jest.unstable_mockModule("../cacheService.js", () => ({
    cacheService: {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
    },
  }));

  // Dynamically import after mocking
  const imported = await import("../cacheService.js");
  mockCacheService = imported.cacheService;
  const svc = await import("../rateLimitService.js");
  rateLimitService = svc.rateLimitService;
  SCORE_UPDATE_RATE_LIMIT = svc.SCORE_UPDATE_RATE_LIMIT;
});

describe("RateLimitService", () => {
  jest.setTimeout(20000);
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("checkRateLimit", () => {
    it("should allow first request", async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue();

      const result = await rateLimitService.checkRateLimit(
        "user123",
        SCORE_UPDATE_RATE_LIMIT,
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4); // 5 - 1
      expect(result.currentCount).toBe(1);
      expect(mockCacheService.set).toHaveBeenCalledWith(
        "rate_limit:user123",
        { count: 1, firstRequest: expect.any(String) },
        86400,
      );
    });

    it("should block request when limit is exceeded", async () => {
      const now = new Date();
      mockCacheService.get.mockResolvedValue({
        count: 5,
        firstRequest: now.toISOString(),
      });

      const result = await rateLimitService.checkRateLimit(
        "user123",
        SCORE_UPDATE_RATE_LIMIT,
      );

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.currentCount).toBe(6);
      expect(mockCacheService.set).not.toHaveBeenCalled();
    });

    it("should reset counter when window expires", async () => {
      const expiredTime = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
      mockCacheService.get.mockResolvedValue({
        count: 5,
        firstRequest: expiredTime.toISOString(),
      });
      mockCacheService.set.mockResolvedValue();

      const result = await rateLimitService.checkRateLimit(
        "user123",
        SCORE_UPDATE_RATE_LIMIT,
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4); // 5 - 1
      expect(result.currentCount).toBe(1);
      expect(mockCacheService.set).toHaveBeenCalledWith(
        "rate_limit:user123",
        { count: 1, firstRequest: expect.any(String) },
        86400,
      );
    });

    it("should fail open when Redis is unavailable", async () => {
      mockCacheService.get.mockRejectedValue(
        new Error("Redis connection failed"),
      );

      const result = await rateLimitService.checkRateLimit(
        "user123",
        SCORE_UPDATE_RATE_LIMIT,
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4); // 5 - 1
      expect(result.currentCount).toBe(1);
    });

    it("should handle different identifiers independently", async () => {
      mockCacheService.get.mockResolvedValue(null);
      mockCacheService.set.mockResolvedValue();

      // First user
      const result1 = await rateLimitService.checkRateLimit(
        "user1",
        SCORE_UPDATE_RATE_LIMIT,
      );
      // Second user
      const result2 = await rateLimitService.checkRateLimit(
        "user2",
        SCORE_UPDATE_RATE_LIMIT,
      );

      expect(result1.allowed).toBe(true);
      expect(result1.currentCount).toBe(1);
      expect(result2.allowed).toBe(true);
      expect(result2.currentCount).toBe(1);
      expect(mockCacheService.set).toHaveBeenCalledTimes(2);
      expect(mockCacheService.set).toHaveBeenCalledWith(
        "rate_limit:user1",
        { count: 1, firstRequest: expect.any(String) },
        86400,
      );
      expect(mockCacheService.set).toHaveBeenCalledWith(
        "rate_limit:user2",
        { count: 1, firstRequest: expect.any(String) },
        86400,
      );
    });
  });

  describe("resetRateLimit", () => {
    it("should reset the rate limit counter", async () => {
      mockCacheService.delete.mockResolvedValue();

      await rateLimitService.resetRateLimit("user123");

      expect(mockCacheService.delete).toHaveBeenCalledWith(
        "rate_limit:user123",
      );
    });

    it("should handle errors gracefully", async () => {
      mockCacheService.delete.mockRejectedValue(new Error("Redis error"));

      await expect(
        rateLimitService.resetRateLimit("user123"),
      ).resolves.not.toThrow();
    });
  });

  describe("getRateLimitStatus", () => {
    it("should return current status without incrementing", async () => {
      const now = new Date();
      mockCacheService.get.mockResolvedValue({
        count: 2,
        firstRequest: now.toISOString(),
      });

      const result = await rateLimitService.getRateLimitStatus(
        "user123",
        SCORE_UPDATE_RATE_LIMIT,
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(3); // 5 - 2
      expect(mockCacheService.set).not.toHaveBeenCalled();
    });

    it("should return default status for new users", async () => {
      mockCacheService.get.mockResolvedValue(null);

      const result = await rateLimitService.getRateLimitStatus(
        "user123",
        SCORE_UPDATE_RATE_LIMIT,
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5);
    });

    it("should handle expired windows", async () => {
      const expiredTime = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
      mockCacheService.get.mockResolvedValue({
        count: 5,
        firstRequest: expiredTime.toISOString(),
      });

      const result = await rateLimitService.getRateLimitStatus(
        "user123",
        SCORE_UPDATE_RATE_LIMIT,
      );

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5); // Reset to full limit
    });
  });
});
