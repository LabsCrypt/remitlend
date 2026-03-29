/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Adds composite and partial indexes to `loan_events` to cover the six
 * most expensive query patterns identified in loanController, poolController,
 * and defaultChecker.
 *
 * All indexes use CREATE INDEX IF NOT EXISTS so the migration is safe to run
 * multiple times (idempotent).
 *
 * Index rationale
 * ---------------
 * idx_loan_events_borrower_event_type  (borrower, event_type)
 *   Covers the getBorrowerLoans GROUP BY query:
 *     WHERE borrower = $1 AND loan_id IS NOT NULL GROUP BY loan_id
 *   and the pool stats query:
 *     WHERE event_type IN ('Deposit', 'Withdraw') AND borrower = $1
 *
 * idx_loan_events_loan_id_event_type   (loan_id, event_type)
 *   Covers getLoanDetails and the defaultChecker sub-query:
 *     WHERE loan_id = $1 ORDER BY ledger_closed_at
 *     WHERE e.loan_id = a.loan_id AND e.event_type IN ('LoanRepaid', 'LoanDefaulted')
 *
 * idx_loan_events_event_type_loan_id   (event_type, loan_id)
 *   Covers the defaultChecker CTE:
 *     WHERE event_type = 'LoanApproved' AND loan_id IS NOT NULL GROUP BY loan_id
 *
 * idx_loan_events_ledger               (ledger)
 *   Covers indexer state-tracking queries; declared IF NOT EXISTS because the
 *   original schema migration already created this single-column index.
 *
 * idx_loan_events_pool_deposits_withdraws  partial (borrower) WHERE event_type IN ('Deposit','Withdraw')
 *   Narrow partial index for the pool controller query that filters on both
 *   event type and borrower — smallest possible index for highest selectivity.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
export const up = (pgm) => {
  // (borrower, event_type) — borrower loan list + pool stats with borrower filter
  pgm.createIndex("loan_events", ["borrower", "event_type"], {
    name: "idx_loan_events_borrower_event_type",
    ifNotExists: true,
  });

  // (loan_id, event_type) — loan detail fetch + defaultChecker repayment sub-query
  pgm.createIndex("loan_events", ["loan_id", "event_type"], {
    name: "idx_loan_events_loan_id_event_type",
    ifNotExists: true,
  });

  // (event_type, loan_id) — defaultChecker approved-loans CTE
  pgm.createIndex("loan_events", ["event_type", "loan_id"], {
    name: "idx_loan_events_event_type_loan_id",
    ifNotExists: true,
  });

  // (ledger) — already exists from the initial schema migration; declared
  // IF NOT EXISTS so this migration stays idempotent if re-run.
  pgm.createIndex("loan_events", "ledger", {
    name: "idx_loan_events_ledger",
    ifNotExists: true,
  });

  // partial index: (borrower) WHERE event_type IN ('Deposit', 'Withdraw')
  // Covers the pool controller query for per-borrower deposit/withdrawal totals.
  pgm.createIndex("loan_events", "borrower", {
    name: "idx_loan_events_pool_deposits_withdraws",
    ifNotExists: true,
    where: "event_type IN ('Deposit', 'Withdraw')",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
export const down = (pgm) => {
  pgm.dropIndex("loan_events", "borrower", {
    name: "idx_loan_events_pool_deposits_withdraws",
    ifExists: true,
  });

  // The ledger index was created by the original schema migration; skip
  // dropping it here so rolling back this migration does not break the
  // earlier one.

  pgm.dropIndex("loan_events", ["event_type", "loan_id"], {
    name: "idx_loan_events_event_type_loan_id",
    ifExists: true,
  });

  pgm.dropIndex("loan_events", ["loan_id", "event_type"], {
    name: "idx_loan_events_loan_id_event_type",
    ifExists: true,
  });

  pgm.dropIndex("loan_events", ["borrower", "event_type"], {
    name: "idx_loan_events_borrower_event_type",
    ifExists: true,
  });
};
