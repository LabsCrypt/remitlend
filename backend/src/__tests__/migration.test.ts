import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { query, getClient } from '../db/connection.js';
import { runner as migrate } from 'node-pg-migrate';
import type { PoolClient } from 'pg';
import { updateUserScoresBulk } from '../services/scoresService.js';

let databaseAvailable = false;

beforeAll(async () => {
  try {
    await query('SELECT 1');
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

describeIf('Migrations', () => {
  let client: PoolClient;

  beforeAll(async () => {
    client = await getClient();
  });

  afterAll(async () => {
    if (client) {
      client.release();
    }
  });

  const runMigrations = async (direction: 'up' | 'down') => {
    await migrate({
      dbClient: client,
      dir: './migrations',
      direction,
      count: Infinity,
    });
  };

  it('should run up then down then up without errors', async () => {
    await runMigrations('up');
    await runMigrations('down');
    await runMigrations('up');
  });

  it('should have the scores table after running up', async () => {
    const result = await query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'scores'
      ) AS exists`,
    );
    expect(result.rows[0]?.exists).toBe(true);
  });

  it('should store and retrieve a score record', async () => {
    await query(
      `INSERT INTO scores (borrower, score)
       VALUES ($1, $2)
       ON CONFLICT (borrower) DO NOTHING`,
      ['G_MIGRATION_TEST_SCORE', 700],
    );

    const result = await query(`SELECT score FROM scores WHERE borrower = $1`, [
      'G_MIGRATION_TEST_SCORE',
    ]);
    expect(Number(result.rows[0]?.score ?? 0)).toBe(700);

    await query(`DELETE FROM scores WHERE borrower = $1`, ['G_MIGRATION_TEST_SCORE']);
  });

  it('should exercise updateUserScoresBulk against post-migration scores table', async () => {
    const testBorrower = 'G_MIGRATION_TEST_BULK_SCORE';
    await query(`DELETE FROM scores WHERE borrower = $1`, [testBorrower]);

    const updates = new Map<string, number>([[testBorrower, 50]]);
    await updateUserScoresBulk(updates);

    const result = await query(`SELECT score FROM scores WHERE borrower = $1`, [testBorrower]);
    expect(Number(result.rows[0]?.score ?? 0)).toBe(550);

    await query(`DELETE FROM scores WHERE borrower = $1`, [testBorrower]);
  });

  it('should have the indexer_state table after running up', async () => {
    const result = await query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'indexer_state'
      ) AS exists`,
    );
    expect(result.rows[0]?.exists).toBe(true);
  });

  it('should have last_ledger and contract columns in indexer_state', async () => {
    const columnsResult = await query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'indexer_state'
       AND column_name IN ('last_ledger', 'contract')`,
    );
    const columns = columnsResult.rows.map((r: { column_name: string }) => r.column_name);
    expect(columns).toContain('last_ledger');
    expect(columns).toContain('contract');
  });

  it('should store and retrieve indexer_state with contract', async () => {
    await query(
      `INSERT INTO indexer_state (contract, last_ledger)
       VALUES ($1, $2)
       ON CONFLICT (contract) DO NOTHING`,
      ['test_contract', 42],
    );

    const result = await query(`SELECT last_ledger FROM indexer_state WHERE contract = $1`, [
      'test_contract',
    ]);
    expect(Number(result.rows[0]?.last_ledger ?? 0)).toBe(42);
  });

  it('supports contract-scoped indexer reads after migration', async () => {
    const contract = 'test_contract';
    const otherContract = 'test_contract_other';

    try {
      await query(
        `INSERT INTO indexer_state (contract, last_ledger)
         VALUES ($1, $2), ($3, $4)
         ON CONFLICT (contract) DO UPDATE SET last_ledger = EXCLUDED.last_ledger`,
        [contract, 42, otherContract, 900],
      );

      // Loan controller, health check, and indexer status must all use
      // the migrated column and select the requested contract.
      const loanLedger = await query(
        'SELECT last_ledger FROM indexer_state WHERE contract = $1 LIMIT 1',
        [contract],
      );
      expect(Number(loanLedger.rows[0]?.last_ledger)).toBe(42);

      const status = await query(
        'SELECT last_ledger, updated_at FROM indexer_state WHERE contract = $1 LIMIT 1',
        [contract],
      );
      expect(Number(status.rows[0]?.last_ledger)).toBe(42);
      expect(status.rows[0]?.updated_at).toBeDefined();

      const health = await query(
        'SELECT last_ledger FROM indexer_state WHERE contract = $1 LIMIT 1',
        [contract],
      );
      expect(Number(health.rows[0]?.last_ledger)).toBe(42);

      // Development seeding must update only the configured contract.
      await query(
        `UPDATE indexer_state SET last_ledger = $1, updated_at = CURRENT_TIMESTAMP
         WHERE contract = $2`,
        [50, contract],
      );
      const rows = await query(
        'SELECT contract, last_ledger FROM indexer_state WHERE contract IN ($1, $2)',
        [contract, otherContract],
      );
      const ledgers = new Map(
        rows.rows.map((row: { contract: string; last_ledger: number }) => [
          row.contract,
          Number(row.last_ledger),
        ]),
      );
      expect(ledgers.get(contract)).toBe(50);
      expect(ledgers.get(otherContract)).toBe(900);
    } finally {
      await query('DELETE FROM indexer_state WHERE contract = $1', [otherContract]);
    }
  });

  it('should have the loan_disputes table after running up', async () => {
    const result = await query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'loan_disputes'
      ) AS exists`,
    );
    expect(result.rows[0]?.exists).toBe(true);
  });

  it('should have the notifications table after running up', async () => {
    const result = await query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'notifications'
      ) AS exists`,
    );
    expect(result.rows[0]?.exists).toBe(true);
  });

  it('should have the loan_events table after running up', async () => {
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
      await query(`DELETE FROM indexer_state WHERE contract = $1`, ['test_contract']);
    } catch {
      // Cleanup failure is non-fatal
    }
  });
});
