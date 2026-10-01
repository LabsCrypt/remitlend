import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

// Mock the rate limit service before importing middleware that depends on it
jest.unstable_mockModule('../../services/rateLimitService.js', () => ({
  rateLimitService: {
    checkRateLimit: jest.fn(),
    resetRateLimit: jest.fn(),
    getRateLimitStatus: jest.fn(),
  },
  SCORE_UPDATE_RATE_LIMIT: {
    maxRequests: 5,
    windowSeconds: 86400,
  },
}));

const mockLoggerInfo = jest.fn();
jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    info: mockLoggerInfo,
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const { createRateLimitMiddleware, scoreUpdateRateLimit, createIpRateLimitMiddleware } =
  await import('../rateLimitMiddleware.js');
const { rateLimitService } = await import('../../services/rateLimitService.js');
const { ErrorCode } = await import('../../errors/errorCodes.js');
const mockRateLimitService = rateLimitService as jest.Mocked<typeof rateLimitService>;

describe('Rate Limit Middleware', () => {
  jest.setTimeout(20000);
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();

    mockRequest = {
      body: { userId: 'user123' },
      path: '/api/score/update',
      method: 'POST',
      ip: '127.0.0.1',
    };

    mockResponse = {
      set: jest.fn(),
    } as unknown as Response;

    mockNext = jest.fn();
  });

  describe('createRateLimitMiddleware', () => {
    it('should allow request within rate limit', async () => {
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

    it('should block request exceeding rate limit', async () => {
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
          message: 'Rate limit exceeded. Please try again later.',
        }),
      );
    });

    it('should use custom identifier function', async () => {
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
        'custom:user123',
        expect.any(Object),
      );
    });

    it('should use custom configuration', async () => {
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

      expect(mockRateLimitService.checkRateLimit).toHaveBeenCalledWith('user123', {
        maxRequests: 10,
        windowSeconds: 3600,
      });
      expect(mockResponse.set).toHaveBeenCalledWith({
        'X-RateLimit-Limit': '10',
        'X-RateLimit-Remaining': '9',
        'X-RateLimit-Reset': expect.any(String),
        'X-RateLimit-Used': '1',
      });
    });

    it('should skip rate limiting when condition is met', async () => {
      const middleware = createRateLimitMiddleware({
        skipIf: (req) => req.body?.userId === 'admin',
      });

      mockRequest.body = { userId: 'admin' };

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRateLimitService.checkRateLimit).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should fail open when rate limit service fails', async () => {
      mockRateLimitService.checkRateLimit.mockRejectedValue(new Error('Redis error'));

      const middleware = createRateLimitMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should reject request when default userId is missing instead of failing open', async () => {
      mockRequest.body = {};

      const middleware = createRateLimitMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          errorCode: ErrorCode.MISSING_FIELD,
          message: 'Rate limiting middleware requires userId in request body',
        }),
      );
      expect(mockRateLimitService.checkRateLimit).not.toHaveBeenCalled();
    });

    it('should reject request when custom getIdentifier throws an error', async () => {
      const middleware = createRateLimitMiddleware({
        getIdentifier: () => {
          throw new Error('API key header is missing');
        },
      });

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          errorCode: ErrorCode.VALIDATION_ERROR,
          message: 'API key header is missing',
        }),
      );
      expect(mockRateLimitService.checkRateLimit).not.toHaveBeenCalled();
    });

    it('should reject request when getIdentifier returns an empty or whitespace string', async () => {
      const middleware = createRateLimitMiddleware({
        getIdentifier: () => '   ',
      });

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          errorCode: ErrorCode.MISSING_FIELD,
          message: 'Rate limiting identifier is required',
        }),
      );
      expect(mockRateLimitService.checkRateLimit).not.toHaveBeenCalled();
    });

    it('should support async getIdentifier functions', async () => {
      mockRateLimitService.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 4,
        resetTime: new Date(Date.now() + 86400 * 1000),
        currentCount: 1,
      });

      const middleware = createRateLimitMiddleware({
        getIdentifier: async () => 'async-user-456',
      });

      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRateLimitService.checkRateLimit).toHaveBeenCalledWith(
        'async-user-456',
        expect.any(Object),
      );
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should log when rate limit is nearing exhaustion', async () => {
      mockRateLimitService.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 0, // 90% of 5 is 4.5, so 0 remaining triggers the log
        resetTime: new Date(Date.now() + 86400 * 1000),
        currentCount: 5,
      });

      const middleware = createRateLimitMiddleware();
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'Rate limit nearing exhaustion',
        expect.objectContaining({
          identifier: 'user123',
          remaining: 0,
          maxRequests: 5,
        }),
      );
    });
  });

  describe('scoreUpdateRateLimit', () => {
    it('should use score update specific configuration', async () => {
      mockRateLimitService.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 4,
        resetTime: new Date(Date.now() + 86400 * 1000),
        currentCount: 1,
      });

      await scoreUpdateRateLimit(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRateLimitService.checkRateLimit).toHaveBeenCalledWith('user123', {
        maxRequests: 5,
        windowSeconds: 86400,
      });
      expect(mockResponse.set).toHaveBeenCalledWith({
        'X-RateLimit-Limit': '5',
        'X-RateLimit-Remaining': '4',
        'X-RateLimit-Reset': expect.any(String),
        'X-RateLimit-Used': '1',
      });
    });

    it('should use custom error message for score updates', async () => {
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
          message: 'Too many score updates. Maximum 5 updates allowed per user per day.',
        }),
      );
    });
  });

  describe('createIpRateLimitMiddleware', () => {
    it('should rate limit using client IP address', async () => {
      mockRateLimitService.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 99,
        resetTime: new Date(Date.now() + 3600 * 1000),
        currentCount: 1,
      });

      const ipMiddleware = createIpRateLimitMiddleware(100, 3600);
      await ipMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRateLimitService.checkRateLimit).toHaveBeenCalledWith('ip:127.0.0.1', {
        maxRequests: 100,
        windowSeconds: 3600,
      });
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should fallback to socket.remoteAddress if req.ip is not available', async () => {
      mockRateLimitService.checkRateLimit.mockResolvedValue({
        allowed: true,
        remaining: 99,
        resetTime: new Date(Date.now() + 3600 * 1000),
        currentCount: 1,
      });

      delete mockRequest.ip;
      (mockRequest as any).socket = { remoteAddress: '192.168.1.1' };

      const ipMiddleware = createIpRateLimitMiddleware(100, 3600);
      await ipMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRateLimitService.checkRateLimit).toHaveBeenCalledWith('ip:192.168.1.1', {
        maxRequests: 100,
        windowSeconds: 3600,
      });
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should reject request when IP address cannot be determined', async () => {
      delete mockRequest.ip;
      (mockRequest as any).socket = undefined;

      const ipMiddleware = createIpRateLimitMiddleware(100, 3600);
      await ipMiddleware(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          errorCode: ErrorCode.VALIDATION_ERROR,
          message: 'Unable to determine client IP address for rate limiting',
        }),
      );
      expect(mockRateLimitService.checkRateLimit).not.toHaveBeenCalled();
    });
  });
});
