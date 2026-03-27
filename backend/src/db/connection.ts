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
  checkExhaustion();
  return withRetry(async () => {
    const client = await pool.connect();
    return client;
  });
};

export const closePool = async () => {
  clearInterval(metricsInterval);
  await pool.end();
};

export default pool;
