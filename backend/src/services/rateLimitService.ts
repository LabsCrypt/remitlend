import { createClient, type RedisClientType } from 'redis';
import logger from '../utils/logger.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

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
 * Uses fixed-window counters with atomic Redis INCR operations.
 */
class RateLimitService {
  private static readonly DEFAULT_CONFIG: RateLimitConfig = {
    maxRequests: 10,
    windowSeconds: 86400, // 24 hours
  };

  private client: RedisClientType;
  private isConnected = false;

  constructor() {
    this.client = createClient({ url: REDIS_URL });
    this.client.on('error', (error) => {
      this.isConnected = false;
      if (process.env.NODE_ENV !== 'test') {
        logger.withContext().error('Rate limit Redis client error', { error });
      }
    });
    this.client.on('connect', () => {
      this.isConnected = true;
    });
  }

  private async ensureConnected(): Promise<void> {
    if (!this.isConnected) {
      await this.client.connect();
      this.isConnected = true;
    }
  }

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

    try {
      await this.ensureConnected();

      // Redis INCR is atomic, so concurrent requests cannot all read the same
      // counter value and pass the boundary together.
      const currentCount = await this.client.incr(key);
      if (currentCount === 1) {
        await this.client.expire(key, config.windowSeconds);
      }

      const ttlSeconds = await this.client.ttl(key);
      const resetTime = new Date(
        Date.now() + (ttlSeconds > 0 ? ttlSeconds : config.windowSeconds) * 1000,
      );
      const allowed = currentCount <= config.maxRequests;
      const remaining = Math.max(0, config.maxRequests - currentCount);

      return {
        allowed,
        remaining,
        resetTime,
        currentCount,
      };
    } catch (error) {
      logger.withContext().error('Rate limit check failed', { identifier, error });

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
      await this.ensureConnected();
      await this.client.del(key);
      logger.withContext().info('Rate limit reset', { identifier });
    } catch (error) {
      logger.withContext().error('Failed to reset rate limit', { identifier, error });
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

    try {
      await this.ensureConnected();
      const currentValue = await this.client.get(key);

      if (!currentValue) {
        const resetTime = new Date(Date.now() + config.windowSeconds * 1000);
        return {
          allowed: true,
          remaining: config.maxRequests,
          resetTime,
        };
      }

      const currentCount = Number.parseInt(currentValue, 10);
      if (!Number.isFinite(currentCount)) {
        const resetTime = new Date(Date.now() + config.windowSeconds * 1000);
        return {
          allowed: true,
          remaining: config.maxRequests,
          resetTime,
        };
      }

      const ttlSeconds = await this.client.ttl(key);
      const resetTime = new Date(
        Date.now() + (ttlSeconds > 0 ? ttlSeconds : config.windowSeconds) * 1000,
      );
      const remaining = Math.max(0, config.maxRequests - currentCount);
      const allowed = currentCount < config.maxRequests;

      return {
        allowed,
        remaining,
        resetTime,
      };
    } catch (error) {
      logger.withContext().error('Failed to get rate limit status', { identifier, error });

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
