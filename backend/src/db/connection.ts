import pg from "pg";
import logger from "../utils/logger.js";

const { Pool } = pg;

// Parse pool configuration from environment
const maxPoolSize = process.env.DB_POOL_MAX
  ? parseInt(process.env.DB_POOL_MAX, 10)
  : 10;
const minPoolSize = process.env.DB_POOL_MIN
  ? parseInt(process.env.DB_POOL_MIN, 10)
  : 2;
const idleTimeoutMillis = process.env.DB_IDLE_TIMEOUT_MS
  ? parseInt(process.env.DB_IDLE_TIMEOUT_MS, 10)
  : 30000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  min: minPoolSize,
  max: maxPoolSize,
  idleTimeoutMillis,
});

let isShuttingDown = false;

// Periodic pool health metrics logging
const metricsInterval = setInterval(() => {
  logger.info("DB Pool Metrics", {
    total: pool.totalCount,
    idle: pool.idleCount,
    active: pool.totalCount - pool.idleCount,
    waiting: pool.waitingCount,
  });
}, 60000);

// Unref the interval so it doesn't keep the process alive
metricsInterval.unref();

// Log idle client errors
pool.on("error", (err: Error) => {
  logger.error("Unexpected error on idle client", err);
});

// Helper for transient failures
const TRANSIENT_ERRORS = [
  "ECONNREFUSED",
  "08000",
  "08003",
  "08006",
  "57P01",
  "57P02",
  "57P03",
];
const MAX_RETRIES = 3;

const withRetry = async <T>(
  operation: () => Promise<T>,
  retries = MAX_RETRIES,
  delay = 500,
): Promise<T> => {
  try {
    return await operation();
  } catch (error: any) {
    if (retries > 0 && TRANSIENT_ERRORS.includes(error.code)) {
      logger.warn(
        `Transient db error (${error.code}). Retrying in ${delay}ms... (${retries} retries left)`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return withRetry(operation, retries - 1, delay * 2);
    }
    throw error;
  }
};

const checkExhaustion = () => {
  if (pool.totalCount >= maxPoolSize && pool.idleCount === 0) {
    logger.warn(
      "DB Pool Exhaustion Warning: All connections are currently in use.",
      {
        waiting: pool.waitingCount,
        active: pool.totalCount,
      },
    );
  }
};

export const query = async (text: string, params?: unknown[]) => {
  if (isShuttingDown) {
    throw new Error("Database pool is shutting down");
  }
  checkExhaustion();
  return withRetry(async () => {
    const start = Date.now();
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug("Executed query", {
      text: text.substring(0, 50),
      duration,
      rows: result.rowCount,
    });
    return result;
  });
};

export const getClient = async () => {
  if (isShuttingDown) {
    throw new Error("Database pool is shutting down");
  }
  checkExhaustion();
  return withRetry(async () => {
    const client = await pool.connect();
    return client;
  });
};

const waitForPoolToDrain = async (timeoutMs: number): Promise<void> => {
  const startedAt = Date.now();

  while (pool.totalCount > 0 && pool.totalCount !== pool.idleCount) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(
        `Timed out waiting for pool to drain active clients after ${timeoutMs}ms`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

export const closePool = async (options?: { timeoutMs?: number }) => {
  const timeoutMs = options?.timeoutMs ?? 10_000;
  isShuttingDown = true;
  clearInterval(metricsInterval);
  await waitForPoolToDrain(timeoutMs);
  await pool.end();
};

export default pool;
