/**
 * Issue #1378: unify decimal precision and rounding into one cross-layer
 * money policy (stroops, PostgreSQL NUMERIC, display).
 *
 * Every column that stores a settlement amount holds raw on-chain stroops
 * (integer, no fractional component — the on-chain `i128` amounts decoded by
 * eventIndexer.ts are already whole stroops). Retyping to `NUMERIC(38,0)`
 * with an explicit `CHECK (value = trunc(value))`:
 *
 *   - documents that these columns are integer stroop counts, not scaled
 *     decimal currency (matching `contracts/money`'s `STROOP_SCALE` and
 *     `backend/src/money/decimal.ts`'s bigint-only arithmetic), and
 *   - makes it impossible for a future write path to silently store a
 *     fractional/scaled value (e.g. `NUMERIC(20,6)`, which would drop the
 *     7th decimal place of a stroop amount) without failing loudly.
 *
 * `NUMERIC(38,0)` comfortably holds an `i128` (max ~1.7e38) at zero scale.
 *
 * `contract_events.amount` is the live money column written by
 * eventIndexer.ts (as a raw stroop string) and read by defaultChecker.ts /
 * the reconciliation helpers in `backend/src/money`. `loan_history` is a
 * legacy/seed-only mirror table (see `backend/src/seed/index.ts`); it is
 * retyped for the same integrity guarantee even though nothing in the
 * request path currently reads it for settlement decisions.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
export const shorthands = undefined;

const MONEY_COLUMNS = [
  { table: 'contract_events', column: 'amount', constraint: 'contract_events_amount_is_stroops' },
  {
    table: 'loan_history',
    column: 'principal_amount',
    constraint: 'loan_history_principal_amount_is_stroops',
  },
  {
    table: 'loan_history',
    column: 'principal_paid',
    constraint: 'loan_history_principal_paid_is_stroops',
  },
  {
    table: 'loan_history',
    column: 'interest_paid',
    constraint: 'loan_history_interest_paid_is_stroops',
  },
  {
    table: 'loan_history',
    column: 'accrued_interest',
    constraint: 'loan_history_accrued_interest_is_stroops',
  },
];

// The backward-compat `loan_events` view (1788000000018_unified-contract-events)
// selects `contract_events.amount`, and PostgreSQL refuses to retype a column a
// view depends on. Drop the view around the ALTER and recreate it verbatim.
const CREATE_LOAN_EVENTS_VIEW = `
  CREATE VIEW loan_events AS
  SELECT
    id,
    event_id,
    event_type,
    loan_id,
    address AS borrower,
    amount,
    ledger,
    ledger_closed_at,
    tx_hash,
    contract_id,
    topics,
    value,
    created_at
  FROM contract_events;
`;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
export const up = (pgm) => {
  pgm.sql('DROP VIEW IF EXISTS loan_events;');
  for (const { table, column, constraint } of MONEY_COLUMNS) {
    // Round any pre-existing fractional values down to whole stroops before
    // the CHECK is added, so historical rows (if any ever slipped in with a
    // fractional value) don't block the migration.
    pgm.sql(
      `UPDATE "${table}" SET "${column}" = trunc("${column}") WHERE "${column}" IS NOT NULL;`,
    );

    pgm.alterColumn(table, column, { type: 'numeric(38,0)' });

    pgm.addConstraint(table, constraint, {
      check: `"${column}" IS NULL OR "${column}" = trunc("${column}")`,
    });
  }
  pgm.sql(CREATE_LOAN_EVENTS_VIEW);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
export const down = (pgm) => {
  pgm.sql('DROP VIEW IF EXISTS loan_events;');
  for (const { table, column, constraint } of [...MONEY_COLUMNS].reverse()) {
    pgm.dropConstraint(table, constraint);
    pgm.alterColumn(table, column, { type: 'numeric' });
  }
  pgm.sql(CREATE_LOAN_EVENTS_VIEW);
};
