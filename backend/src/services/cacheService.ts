import { createClient, type RedisClientType } from "redis";
import logger from "../utils/logger.js";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

class CacheService {
  private client: RedisClientType;
  private isConnected: boolean = false;

  constructor() {
    this.client = createClient({
      url: REDIS_URL,
    });

    this.client.on("error", (err) => {
      logger.error("Redis Client Error", err);
      this.isConnected = false;
    });

    this.client.on("connect", () => {
      logger.info("Redis Client Connected");
      this.isConnected = true;
    });

    this.client.on("reconnecting", () => {
      logger.info("Redis Client Reconnecting");
    });

    // Attempt to connect immediately. If it fails it will reconnect in the background.
    this.connect().catch((err) => {
      logger.error("Initial Redis connection failed", err);
    });
  }

  private async connect() {
    if (!this.isConnected) {
      await this.client.connect();
    }
  }

  /**
   * Set a value in the cache with an optional Time-To-Live (TTL).
   * @param key The cache key
   * @param value The value to cache (will be stringified)
   * @param ttlSeconds The TTL in seconds (default: 300 = 5 minutes)
   */
  async set(
    key: string,
    value: unknown,
    ttlSeconds: number = 300,
  ): Promise<void> {
    try {
      if (!this.isConnected) return;

      const stringValue = JSON.stringify(value);
      await this.client.setEx(key, ttlSeconds, stringValue);
    } catch (error) {
      logger.error(`Error setting cache for key ${key}`, { error });
    }
  }

  /**
   * Get a value from the cache.
   * @param key The cache key
   * @returns The parsed value, or null if not found or error
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      if (!this.isConnected) return null;

      const value = await this.client.get(key);
      if (!value) return null;

      return JSON.parse(value) as T;
    } catch (error) {
      logger.error(`Error getting cache for key ${key}`, { error });
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
  async setNotExists(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<boolean> {
    try {
      if (!this.isConnected) return false;

      const stringValue = JSON.stringify(value);
      // SET key value NX EX ttlSeconds
      const result = await this.client.set(key, stringValue, {
        NX: true,
        EX: ttlSeconds,
      });
      return result === "OK";
    } catch (error) {
      logger.error(`Error setting NX cache for key ${key}`, { error });
      return false;
    }
  }

  /**
   * Delete a value from the cache.
   * @param key The cache key
   */
  async delete(key: string): Promise<void> {
    try {
      if (!this.isConnected) return;
      await this.client.del(key);
    } catch (error) {
      logger.error(`Error deleting cache for key ${key}`, { error });
    }
  }

  /**
   * Invalidate multiple keys by a pattern (e.g. prefix)
   * Note: KEYS is generally not recommended in production, but suitable for exact or bounded patterns.
   */
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      if (!this.isConnected) return;
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
      }
    } catch (error) {
      logger.error(`Error invalidating pattern ${pattern}`, { error });
    }
  }

  /**
   * Ping the Redis server to verify connectivity.
   * Returns "ok" on success or "error" if unreachable.
   */
  async ping(): Promise<"ok" | "error"> {
    try {
      if (!this.isConnected) return "error";
      const reply = await this.client.ping();
      return reply === "PONG" ? "ok" : "error";
    } catch {
      return "error";
    }
  }

  async close(): Promise<void> {
    if (this.isConnected) {
      await this.client.quit();
      this.isConnected = false;
    }
  }
}

// Export a singleton instance
export const cacheService = new CacheService();
