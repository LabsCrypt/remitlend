import { cacheService } from "./cacheService.js";
import logger from "../utils/logger.js";

interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: Date;
  currentCount: number;
}

/**
 * Redis-based rate limiting service for API endpoints.
 * Uses sliding window counters with TTL expiry.
 */
class RateLimitService {
  private static readonly DEFAULT_CONFIG: RateLimitConfig = {
    maxRequests: 10,
    windowSeconds: 86400, // 24 hours
  };

  /**
   * Check if a request is allowed based on rate limit rules.
   * 
   * @param identifier Unique identifier (e.g., userId, IP address)
   * @param config Rate limit configuration
   * @returns Rate limit result with allowance status and metadata
   */
  async checkRateLimit(
    identifier: string,
    config: RateLimitConfig = RateLimitService.DEFAULT_CONFIG,
  ): Promise<RateLimitResult> {
    const key = `rate_limit:${identifier}`;
    const now = new Date();
    const windowStart = new Date(now.getTime() - config.windowSeconds * 1000);

    try {
      // Get current request count
      const currentData = await cacheService.get<{ count: number; firstRequest: string }>(key);
      
      let currentCount = 0;
      let firstRequest = now.toISOString();

      if (currentData) {
        const firstRequestDate = new Date(currentData.firstRequest);
        
        // If the window has expired, reset the counter
        if (firstRequestDate < windowStart) {
          currentCount = 1;
          firstRequest = now.toISOString();
        } else {
          currentCount = currentData.count + 1;
          firstRequest = currentData.firstRequest;
        }
      } else {
        // First request in the window
        currentCount = 1;
        firstRequest = now.toISOString();
      }

      // Check if rate limit is exceeded
      const allowed = currentCount <= config.maxRequests;
      const remaining = Math.max(0, config.maxRequests - currentCount);
      const resetTime = new Date(new Date(firstRequest).getTime() + config.windowSeconds * 1000);

      // Update the counter in Redis with TTL
      if (allowed) {
        await cacheService.set(
          key,
          { count: currentCount, firstRequest },
          config.windowSeconds,
        );
      }

      return {
        allowed,
        remaining,
        resetTime,
        currentCount,
      };
    } catch (error) {
      logger.error("Rate limit check failed", { identifier, error });
      
      // Fail open: allow the request if Redis is unavailable
      // This prevents the entire service from failing due to rate limiting issues
      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        resetTime: new Date(Date.now() + config.windowSeconds * 1000),
        currentCount: 1,
      };
    }
  }

  /**
   * Reset the rate limit counter for a specific identifier.
   * Useful for testing or administrative purposes.
   * 
   * @param identifier Unique identifier to reset
   */
  async resetRateLimit(identifier: string): Promise<void> {
    const key = `rate_limit:${identifier}`;
    try {
      await cacheService.delete(key);
      logger.info("Rate limit reset", { identifier });
    } catch (error) {
      logger.error("Failed to reset rate limit", { identifier, error });
    }
  }

  /**
   * Get current rate limit status without incrementing the counter.
   * 
   * @param identifier Unique identifier
   * @param config Rate limit configuration
   * @returns Current rate limit status
   */
  async getRateLimitStatus(
    identifier: string,
    config: RateLimitConfig = RateLimitService.DEFAULT_CONFIG,
  ): Promise<Omit<RateLimitResult, 'currentCount'>> {
    const key = `rate_limit:${identifier}`;
    const now = new Date();
    const windowStart = new Date(now.getTime() - config.windowSeconds * 1000);

    try {
      const currentData = await cacheService.get<{ count: number; firstRequest: string }>(key);
      
      if (!currentData) {
        const resetTime = new Date(Date.now() + config.windowSeconds * 1000);
        return {
          allowed: true,
          remaining: config.maxRequests,
          resetTime,
        };
      }

      const firstRequestDate = new Date(currentData.firstRequest);
      
      // If the window has expired, consider it as reset
      if (firstRequestDate < windowStart) {
        const resetTime = new Date(Date.now() + config.windowSeconds * 1000);
        return {
          allowed: true,
          remaining: config.maxRequests,
          resetTime,
        };
      }

      const resetTime = new Date(firstRequestDate.getTime() + config.windowSeconds * 1000);
      const remaining = Math.max(0, config.maxRequests - currentData.count);
      const allowed = currentData.count < config.maxRequests;

      return {
        allowed,
        remaining,
        resetTime,
      };
    } catch (error) {
      logger.error("Failed to get rate limit status", { identifier, error });
      
      // Return conservative values on error
      return {
        allowed: true,
        remaining: config.maxRequests,
        resetTime: new Date(Date.now() + config.windowSeconds * 1000),
      };
    }
  }
}

// Export singleton instance
export const rateLimitService = new RateLimitService();

// Export configuration constants for score updates
export const SCORE_UPDATE_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 5, // Maximum 5 score updates per user per day
  windowSeconds: 86400, // 24 hours
};
