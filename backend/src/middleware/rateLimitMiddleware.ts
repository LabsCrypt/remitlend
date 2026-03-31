import type { Request, Response, NextFunction } from "express";
import { rateLimitService, SCORE_UPDATE_RATE_LIMIT } from "../services/rateLimitService.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/errorCodes.js";
import logger from "../utils/logger.js";

/**
 * Rate limiting middleware configuration
 */
interface RateLimitMiddlewareOptions {
  /**
   * Function to extract the identifier from the request
   * Defaults to using userId from request body
   */
  getIdentifier?: (req: Request) => string;
  /**
   * Custom rate limit configuration
   * Defaults to SCORE_UPDATE_RATE_LIMIT
   */
  config?: {
    maxRequests: number;
    windowSeconds: number;
  };
  /**
   * Skip rate limiting if this function returns true
   * Useful for bypassing rate limiting in certain conditions
   */
  skipIf?: (req: Request) => boolean;
  /**
   * Custom error message
   */
  errorMessage?: string;
}

/**
 * Creates a rate limiting middleware for Express endpoints.
 * Uses Redis-based sliding window counters with TTL expiry.
 * 
 * @param options Rate limiting configuration options
 * @returns Express middleware function
 */
export const createRateLimitMiddleware = (options: RateLimitMiddlewareOptions = {}) => {
  const {
    getIdentifier = (req: Request) => {
      // Default: extract userId from request body for score updates
      const body = req.body as { userId?: string } | undefined;
      if (!body?.userId) {
        throw new Error("Rate limiting middleware requires userId in request body");
      }
      return body.userId;
    },
    config = SCORE_UPDATE_RATE_LIMIT,
    skipIf = () => false,
    errorMessage = "Rate limit exceeded. Please try again later.",
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Skip rate limiting if condition is met
      if (skipIf(req)) {
        return next();
      }

      // Extract identifier for rate limiting
      const identifier = getIdentifier(req);
      
      // Check rate limit
      const result = await rateLimitService.checkRateLimit(identifier, config);

      // Add rate limit headers to response
      res.set({
        'X-RateLimit-Limit': config.maxRequests.toString(),
        'X-RateLimit-Remaining': result.remaining.toString(),
        'X-RateLimit-Reset': Math.ceil(result.resetTime.getTime() / 1000).toString(),
        'X-RateLimit-Used': result.currentCount.toString(),
      });

      // Block request if rate limit is exceeded
      if (!result.allowed) {
        logger.warn("Rate limit exceeded", {
          identifier,
          currentCount: result.currentCount,
          maxRequests: config.maxRequests,
          resetTime: result.resetTime,
          path: req.path,
          method: req.method,
        });

        throw AppError.withCode(ErrorCode.RATE_LIMIT_EXCEEDED, errorMessage);
      }

      // Log rate limit status for monitoring
      if (result.remaining <= Math.ceil(config.maxRequests * 0.1)) { // Log when 90% used
        logger.info("Rate limit nearing exhaustion", {
          identifier,
          remaining: result.remaining,
          maxRequests: config.maxRequests,
          resetTime: result.resetTime,
          path: req.path,
        });
      }

      next();
    } catch (error) {
      // If the error is already an AppError, pass it through
      if (error instanceof AppError) {
        return next(error);
      }

      // Log unexpected errors and fail open (allow the request)
      logger.error("Rate limiting middleware error", {
        error: error instanceof Error ? error.message : String(error),
        path: req.path,
        method: req.method,
      });

      // Fail open to prevent service disruption
      next();
    }
  };
};

/**
 * Pre-configured rate limiting middleware for score update endpoints.
 * Limits to 5 score updates per user per day.
 */
export const scoreUpdateRateLimit = createRateLimitMiddleware({
  config: SCORE_UPDATE_RATE_LIMIT,
  errorMessage: "Too many score updates. Maximum 5 updates allowed per user per day.",
});

/**
 * Rate limiting middleware that uses IP address as identifier.
 * Useful for general API rate limiting.
 */
export const createIpRateLimitMiddleware = (
  maxRequests: number = 100,
  windowSeconds: number = 3600, // 1 hour
) => createRateLimitMiddleware({
  getIdentifier: (req: Request) => {
    const ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    if (!ip) {
      throw new Error("Unable to determine client IP address for rate limiting");
    }
    return `ip:${ip}`;
  },
  config: { maxRequests, windowSeconds },
  errorMessage: `Too many requests. Maximum ${maxRequests} requests allowed per hour.`,
});
