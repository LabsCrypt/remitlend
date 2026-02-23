import pg from "pg";
import logger from "../utils/logger.js";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const query = async (text: string, params?: unknown[]) => {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  logger.debug("Executed query", {
    text: text.substring(0, 50),
    duration,
    rows: result.rowCount,
  });
  return result;
};

export const getClient = async () => {
  const client = await pool.connect();
  return client;
};

export const closePool = async () => {
  await pool.end();
};

export default pool;
