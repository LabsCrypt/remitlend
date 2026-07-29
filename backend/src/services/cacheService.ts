import { createClient, type RedisClientType } from 'redis';
import logger from '../utils/logger.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

class CacheService {
  private client: RedisClientType | undefined;
  private isConnected: boolean = false;

  constructor() {
    this.client = createClient({
      url: REDIS_URL,
    });

    this.client.on('error', (err) => {
      // In tests, we don't want to spam the console with ECONNREFUSED if Redis isn't running
      if (process.env.NODE_ENV !== 'test' || err.code !== 'ECONNREFUSED') {
        logger.withContext().error('Redis Client Error', err);
      }
      this.isConnected = false;
    });

    this.client.on('connect', () => {
      logger.withContext().info('Redis Client Connected');
      this.isConnected = true;
    });

    this.client.on('reconnecting', () => {
      // Only log reconnecting in non-test environments to keep test output clean
      if (process.env.NODE_ENV !== 'test') {
        logger.withContext().info('Redis Client Reconnecting');
      }
    });

    // Connection is now lazy-loaded on first request to avoid side effects on import.
  }

  private async ensureConnected() {
    if (!this.isConnected) {
      try {
        await this.client!.connect();
        this.isConnected = true;
      } catch (err) {
        // Silently fail in tests if connection fails, but log in production
        if (process.env.NODE_ENV !== 'test') {
          logger.withContext().error('Failed to connect to Redis', err);
        }
        throw err;
      }
    }
  }

  /**
   * Set a value in the cache with an optional Time-To-Live (TTL).
   * @param key The cache key
   * @param value The value to cache (will be stringified)
   * @param ttlSeconds The TTL in seconds (default: 300 = 5 minutes)
   */
  async set(key: string, value: unknown, ttlSeconds: number = 300): Promise<void> {
    try {
      await this.ensureConnected();
      const stringValue = JSON.stringify(value);
      await this.client!.setEx(key, ttlSeconds, stringValue);
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        logger.withContext().error(`Error setting cache for key ${key}`, { error });
      }
    }
  }

  /**
   * Get a value from the cache.
   * @param key The cache key
   * @returns The parsed value, or null if not found or error
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      await this.ensureConnected();
      const value = await this.client!.get(key);
      if (!value) return null;

      return JSON.parse(value) as T;
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        logger.withContext().error(`Error getting cache for key ${key}`, { error });
      }
      return null;
    }
  }

  /**
   * Set a value only if the key does not exist (SET NX - Set if Not Exists).
   * Used for distributed locking.
   * @param key The cache key
   * @param value The value to cache
   * @param ttlSeconds The TTL in seconds
   * @returns true if the key was set, false if the key already existed
   */
  async setNotExists(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    try {
      await this.ensureConnected();
      if (!this.isConnected) return false;

      const stringValue = JSON.stringify(value);
      // SET key value NX EX ttlSeconds
      const result = await this.client!.set(key, stringValue, {
        NX: true,
        EX: ttlSeconds,
      });
      return result === 'OK';
    } catch (error) {
      logger.withContext().error(`Error setting NX cache for key ${key}`, { error });
      return false;
    }
  }

  /**
   * Delete a value from the cache.
   * @param key The cache key
   */
  async delete(key: string): Promise<void> {
    try {
      await this.ensureConnected();
      await this.client!.del(key);
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        logger.withContext().error(`Error deleting cache for key ${key}`, { error });
      }
    }
  }

  private static readonly COMPARE_AND_DELETE_SCRIPT = `
local stored = redis.call('GET', KEYS[1])
if stored == false then
  return 0
end
if stored == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

  /**
   * Delete a key only when its stored value matches `expectedValue` (fenced
   * compare-and-delete).  Used by distributed locks so a run that outlives the
   * TTL cannot delete a lock acquired by a different instance.
   *
   * The match-and-delete is performed atomically via a Lua script so that a
   * stale lock cannot be deleted between the read and the delete by a
   * different instance that re-acquired the lock in the window.
   *
   * @returns true if the key existed and the value matched (key deleted),
   *          false if the key was absent or the value did not match.
   */
  async deleteIfMatch(key: string, expectedValue: string): Promise<boolean> {
    try {
      await this.ensureConnected();
      const result = await this.client!.eval(CacheService.COMPARE_AND_DELETE_SCRIPT, {
        keys: [key],
        arguments: [JSON.stringify(expectedValue)],
      });
      return result === 1;
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        logger.withContext().error(`Error in deleteIfMatch for key ${key}`, { error });
      }
      return false;
    }
  }

  /**
   * Invalidate multiple keys by a pattern (e.g. prefix)
   * Note: KEYS is generally not recommended in production, but suitable for exact or bounded patterns.
   */
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      await this.ensureConnected();
      const keys = await this.client!.keys(pattern);
      if (keys.length > 0) {
        await this.client!.del(keys);
      }
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        logger.withContext().error(`Error invalidating pattern ${pattern}`, { error });
      }
    }
  }

  /**
   * Ping the Redis server to verify connectivity.
   * Returns "ok" on success or "error" if unreachable.
   */
  async ping(): Promise<'ok' | 'error'> {
    try {
      await this.ensureConnected();
      const reply = await this.client!.ping();
      return reply === 'PONG' ? 'ok' : 'error';
    } catch {
      return 'error';
    }
  }

  async close(): Promise<void> {
    if (this.isConnected && this.client) {
      await this.client.quit();
      this.isConnected = false;
    }
  }
}

// Export a singleton instance
export const cacheService = new CacheService();
