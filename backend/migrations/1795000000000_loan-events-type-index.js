/**
 * Issue #1194: Port the orphan SQL migration from src/db/migrations/ into the
 * real migrations directory so node-pg-migrate actually applies it.
 *
 * CREATE INDEX CONCURRENTLY cannot run inside a transaction, so this migration
 * uses the non-transactional option supported by node-pg-migrate.
 */

/** @type {import('node-pg-migrate').MigrationBuilder} */
export const up = async (pgm) => {
  // loan_events is now a backward-compat VIEW (created by
  // 1788000000018_unified-contract-events); the real table is contract_events.
  // Target the table so the index attaches to actual storage.
  pgm.noTransaction();
  pgm.sql(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contract_events_type_created_at
      ON contract_events (event_type, created_at)
  `);
};

/** @type {import('node-pg-migrate').MigrationBuilder} */
export const down = async (pgm) => {
  pgm.noTransaction();
  pgm.sql(`
    DROP INDEX CONCURRENTLY IF EXISTS idx_contract_events_type_created_at
  `);
};
