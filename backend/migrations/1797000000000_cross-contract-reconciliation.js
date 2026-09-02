/**
 * Cross-contract reconciliation ledger (issue #1377).
 *
 * A durable record of every custody-changing loan event (approve / repay /
 * default) and whether its expected credit-score mutation was observed
 * on-chain. Lets an operator/reconciler detect and repair the "funds without
 * score / score without funds" divergence that the atomic-boundary invariant
 * is meant to prevent.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable('cross_contract_reconciliation', {
    id: 'id',
    // Deterministic idempotency key: `${operation}:${loan_id}:${event_id}`.
    intent_key: { type: 'varchar(255)', notNull: true, unique: true },
    loan_id: { type: 'integer' },
    borrower: { type: 'varchar(255)', notNull: true },
    operation: {
      type: 'varchar(16)',
      notNull: true,
      check: "operation IN ('approve', 'repay', 'default')",
    },
    disbursement_ledger: { type: 'integer' },
    disbursement_tx_hash: { type: 'varchar(255)' },
    // Expected credit-score change for this custody event (0 = none expected).
    expected_score_delta: { type: 'integer', notNull: true, default: 0 },
    score_applied: { type: 'boolean', notNull: true, default: false },
    score_ledger: { type: 'integer' },
    state: {
      type: 'varchar(16)',
      notNull: true,
      default: 'pending',
      check: "state IN ('pending', 'half_applied', 'reconciled', 'failed')",
    },
    attempts: { type: 'integer', notNull: true, default: 0 },
    last_checked_at: { type: 'timestamp' },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    updated_at: { type: 'timestamp' },
  });

  pgm.createIndex('cross_contract_reconciliation', 'state');
  pgm.createIndex('cross_contract_reconciliation', 'borrower');
  pgm.createIndex('cross_contract_reconciliation', 'loan_id');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('cross_contract_reconciliation');
};
