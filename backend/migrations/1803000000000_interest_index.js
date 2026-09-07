/**
 * Migration: 1803000000000_interest_index.js
 *
 * Adds interest_index table for persistent cumulative borrow index snapshots (issue #1382).
 * NUMERIC(78, 0) accommodates the full i128 range exactly without truncation or float drift.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
export const up = (pgm) => {
  pgm.createTable(
    'interest_index',
    {
      loan_id: { type: 'bigint', notNull: true },
      ledger_seq: { type: 'bigint', notNull: true },
      index_value: { type: 'numeric(78, 0)', notNull: true },
      origin_index: { type: 'numeric(78, 0)', notNull: true },
      created_at: {
        type: 'timestamptz',
        notNull: true,
        default: pgm.func('CURRENT_TIMESTAMP'),
      },
    },
    {
      ifNotExists: true,
      constraints: {
        primaryKey: ['loan_id', 'ledger_seq'],
      },
    },
  );

  pgm.createIndex('interest_index', ['loan_id', 'ledger_seq'], {
    name: 'idx_interest_index_loan_ledger',
    ifNotExists: true,
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
export const down = (pgm) => {
  pgm.dropTable('interest_index', { ifExists: true });
};
