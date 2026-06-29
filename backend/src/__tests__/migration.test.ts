import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { query, getClient } from "../db/connection.js";
import { runner as migrate } from "node-pg-migrate";
import type { PoolClient } from "pg";

let databaseAvailable = false;

beforeAll(async () => {
  try {
    await query("SELECT 1");
    databaseAvailable = true;
  } catch {
    databaseAvailable = false;
  }
});

const describeIf = (name: string, fn: () => void) => {
  if (databaseAvailable) {
    describe(name, fn);
  } else {
    describe.skip(`${name} (skipped: no database)`, fn);
  }
};

describeIf("Migrations", () => {
  let client: PoolClient;

  beforeAll(async () => {
    client = await getClient();
  });

  afterAll(async () => {
    if (client) {
      client.release();
    }
  });

  const runMigrations = async (direction: "up" | "down") => {
    await migrate({
      dbClient: client,
      dir: "./migrations",
      direction,
      count: Infinity,
    });
  };

  it("should run up then down then up without errors", async () => {
    await runMigrations("up");
    await runMigrations("down");
    await runMigrations("up");
  });

  it("should have the scores table after running up", async () => {
    const result = await query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'scores'
      ) AS exists`,
    );
    expect(result.rows[0]?.exists).toBe(true);
  });

  it("should store and retrieve a score record", async () => {
    await query(
      `INSERT INTO scores (borrower, score)
       VALUES ($1, $2)
       ON CONFLICT (borrower) DO NOTHING`,
      ["G_MIGRATION_TEST_SCORE", 700],
    );

    const result = await query(
      `SELECT score FROM scores WHERE borrower = $1`,
      ["G_MIGRATION_TEST_SCORE"],
    );
    expect(Number(result.rows[0]?.score ?? 0)).toBe(700);

    await query(`DELETE FROM scores WHERE borrower = $1`, [
      "G_MIGRATION_TEST_SCORE",
    ]);
  });

  it("should have the indexer_state table after running up", async () => {
    const result = await query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'indexer_state'
      ) AS exists`,
    );
    expect(result.rows[0]?.exists).toBe(true);
  });

  it("should have last_ledger and contract columns in indexer_state", async () => {
    const columnsResult = await query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'indexer_state'
       AND column_name IN ('last_ledger', 'contract')`,
    );
    const columns = columnsResult.rows.map(
      (r: { column_name: string }) => r.column_name,
    );
    expect(columns).toContain("last_ledger");
    expect(columns).toContain("contract");
  });

  it("should store and retrieve indexer_state with contract", async () => {
    await query(
      `INSERT INTO indexer_state (contract, last_ledger)
       VALUES ($1, $2)
       ON CONFLICT (contract) DO NOTHING`,
      ["test_contract", 42],
    );

    const result = await query(
      `SELECT last_ledger FROM indexer_state WHERE contract = $1`,
      ["test_contract"],
    );
    expect(Number(result.rows[0]?.last_ledger ?? 0)).toBe(42);
  });

  it("should have the loan_disputes table after running up", async () => {
    const result = await query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'loan_disputes'
      ) AS exists`,
    );
    expect(result.rows[0]?.exists).toBe(true);
  });

  it("should have the notifications table after running up", async () => {
    const result = await query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'notifications'
      ) AS exists`,
    );
    expect(result.rows[0]?.exists).toBe(true);
  });

  it("should have the loan_events table after running up", async () => {
    const result = await query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'loan_events'
      ) AS exists`,
    );
    expect(result.rows[0]?.exists).toBe(true);
  });

  afterAll(async () => {
    try {
      await query(`DELETE FROM indexer_state WHERE contract = $1`, [
        "test_contract",
      ]);
    } catch {
      // Cleanup failure is non-fatal
    }
  });
});
