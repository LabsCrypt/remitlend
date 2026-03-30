import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Request, Response, NextFunction } from "express";
import { createRateLimitMiddleware, scoreUpdateRateLimit } from "../rateLimitMiddleware.js";
import { rateLimitService } from "../../services/rateLimitService.js";
import { AppError } from "../../errors/AppError.js";

// Mock the rate limit service
jest.unstable_mockModule("../../services/rateLimitService.js", () => ({
  rateLimitService: {
    checkRateLimit: jest.fn(),
    resetRateLimit: jest.fn(),
    getRateLimitStatus: jest.fn(),
  },
}));

const mockRateLimitService = (await import("../../services/rateLimitService.js")).rateLimitService as jest.Mocked<typeof rateLimitService>;

describe("Rate Limit Middleware", () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockRequest = {
      body: { userId: "user123" },
      path: "/api/score/update",
      method: "POST",
      ip: "127.0.0.1",
    };
    
    mockResponse = {
      set: jest.fn(),
    } as any;
    
    mockNext = jest.fn();
  });

  describe("createRateLimitMiddleware", () => {
    it("should allow request within rate limit", async () => {
      mockRateLimitService.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 4,
        resetTime: new Date(Date.now() + 86400 * 1000),
        currentCount: 1,
      });

      const middleware = createRateLimitMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
      expect(mockResponse.set).toHaveBeenCalledWith({
        'X-RateLimit-Limit': '5',
        'X-RateLimit-Remaining': '4',
        'X-RateLimit-Reset': expect.any(String),
        'X-RateLimit-Used': '1',
      });
    });

    it("should block request exceeding rate limit", async () => {
      mockRateLimitService.checkRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetTime: new Date(Date.now() + 86400 * 1000),
        currentCount: 6,
      });

      const middleware = createRateLimitMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 429,
          message: "Rate limit exceeded. Please try again later.",
        })
      );
    });

    it("should use custom identifier function", async () => {
      mockRateLimitService.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 4,
        resetTime: new Date(Date.now() + 86400 * 1000),
        currentCount: 1,
      });

      const middleware = createRateLimitMiddleware({
        getIdentifier: (req) => `custom:${req.body?.userId}`,
      });
      
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRateLimitService.checkRateLimit).toHaveBeenCalledWith(
        "custom:user123",
        expect.any(Object),
      );
    });

    it("should use custom configuration", async () => {
      mockRateLimitService.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 9,
        resetTime: new Date(Date.now() + 3600 * 1000),
        currentCount: 1,
      });

      const middleware = createRateLimitMiddleware({
        config: { maxRequests: 10, windowSeconds: 3600 },
      });
      
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRateLimitService.checkRateLimit).toHaveBeenCalledWith(
        "user123",
        { maxRequests: 10, windowSeconds: 3600 },
      );
      expect(mockResponse.set).toHaveBeenCalledWith({
        'X-RateLimit-Limit': '10',
        'X-RateLimit-Remaining': '9',
        'X-RateLimit-Reset': expect.any(String),
        'X-RateLimit-Used': '1',
      });
    });

    it("should skip rate limiting when condition is met", async () => {
      const middleware = createRateLimitMiddleware({
        skipIf: (req) => req.body?.userId === "admin",
      });
      
      mockRequest.body = { userId: "admin" };
      
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRateLimitService.checkRateLimit).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledWith();
    });

    it("should fail open when rate limit service fails", async () => {
      mockRateLimitService.checkRateLimit.mockRejectedValue(new Error("Redis error"));

      const middleware = createRateLimitMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it("should handle missing userId gracefully", async () => {
      mockRequest.body = {};

      const middleware = createRateLimitMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
        })
      );
    });

    it("should log when rate limit is nearing exhaustion", async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      
      mockRateLimitService.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 0, // 90% of 5 is 4.5, so 0 remaining triggers the log
        resetTime: new Date(Date.now() + 86400 * 1000),
        currentCount: 5,
      });

      const middleware = createRateLimitMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Rate limit nearing exhaustion"),
        expect.any(Object),
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe("scoreUpdateRateLimit", () => {
    it("should use score update specific configuration", async () => {
      mockRateLimitService.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 4,
        resetTime: new Date(Date.now() + 86400 * 1000),
        currentCount: 1,
      });

      await scoreUpdateRateLimit(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRateLimitService.checkRateLimit).toHaveBeenCalledWith(
        "user123",
        { maxRequests: 5, windowSeconds: 86400 },
      );
      expect(mockResponse.set).toHaveBeenCalledWith({
        'X-RateLimit-Limit': '5',
        'X-RateLimit-Remaining': '4',
        'X-RateLimit-Reset': expect.any(String),
        'X-RateLimit-Used': '1',
      });
    });

    it("should use custom error message for score updates", async () => {
      mockRateLimitService.checkRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetTime: new Date(Date.now() + 86400 * 1000),
        currentCount: 6,
      });

      await scoreUpdateRateLimit(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 429,
          message: "Too many score updates. Maximum 5 updates allowed per user per day.",
        })
      );
    });
  });
});
