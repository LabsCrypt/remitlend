import { createClient } from "redis";
import logger from "../utils/logger.js";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

export const redisClient = createClient({ url: redisUrl });

redisClient.on("error", (err: Error) =>
  logger.error("Redis client error", err),
);

redisClient.on("connect", () => logger.info("Redis client connected"));

// Connect lazily on first use so the app doesn't crash if Redis is absent
let _connected = false;
export const ensureConnected = async (): Promise<void> => {
  if (!_connected) {
    await redisClient.connect();
    _connected = true;
  }
};

/**
 * Get a cached JSON value. Returns null on miss or Redis unavailability.
 */
export const getCache = async <T>(key: string): Promise<T | null> => {
  try {
    await ensureConnected();
    const raw = await redisClient.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    logger.warn("Redis getCache error — bypassing cache", { key, err });
    return null;
  }
};

/**
 * Store a JSON value with an optional TTL in seconds (default: 30 s).
 */
export const setCache = async (
  key: string,
  value: unknown,
  ttlSeconds = 30,
): Promise<void> => {
  try {
    await ensureConnected();
    await redisClient.set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch (err) {
    logger.warn("Redis setCache error — skipping cache write", { key, err });
  }
};
