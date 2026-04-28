import pg, { type PoolClient } from "pg";
import logger from "../utils/logger.js";

export type { PoolClient };

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
export const TRANSIENT_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "08000",
  "08003",
  "08006",
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "40001", // serialization_failure
  "40P01", // deadlock_detected
]);
const MAX_RETRIES = 3;

const withRetry = async <T>(
  operation: () => Promise<T>,
  retries = MAX_RETRIES,
  delay = 500,
): Promise<T> => {
  try {
    return await operation();
  } catch (error: any) {
    if (retries > 0 && TRANSIENT_ERROR_CODES.has(error.code)) {
      logger.warn(
        `Transient db error (${error.code}). Retrying in ${delay}ms... (${retries} retries left)`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return withRetry(operation, retries - 1, delay * 2);
    }
    throw error;
  }
};

/**
 * Execute `fn` inside a single dedicated database transaction.
 *
 * A single PoolClient is checked out for the lifetime of the call so that
 * BEGIN / all DML / COMMIT all run on the **same** PostgreSQL connection.
 * If `fn` throws, or if any transient error is encountered, the transaction
 * is rolled back and the error is re-thrown after up to `maxRetries` attempts
 * with exponential back-off.
 *
 * @param fn         Callback that receives the pinned client.
 * @param maxRetries Number of retry attempts on transient errors (default 3).
 * @param baseDelayMs Initial back-off delay in milliseconds (doubles each retry).
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 200,
): Promise<T> {
  let attempt = 0;

  while (true) {
    const client = await getClient();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error: any) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        logger.error("Failed to rollback transaction", { rollbackError });
      }

      const isTransient = TRANSIENT_ERROR_CODES.has(error?.code);
      if (isTransient && attempt < maxRetries) {
        const delay = baseDelayMs * 2 ** attempt;
        attempt++;
        logger.warn(
          `Transient DB error in transaction (${error.code}). ` +
            `Retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    } finally {
      client.release();
    }
  }
}

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

// Add drain method for graceful shutdown
if (!(pool as any).drain) {
  (pool as any).drain = async () => {
    await pool.end();
  };
}
