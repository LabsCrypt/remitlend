/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Issue #438: add missing indexes used by borrower history, event filtering,
 * loan detail lookups, and date-range scans.
 *
 * Uses explicit names + IF NOT EXISTS for safe re-runs.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
export const up = (pgm) => {
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_loan_events_borrower
      ON loan_events (borrower);
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_loan_events_event_type
      ON loan_events (event_type);
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_loan_events_loan_id_event_type
      ON loan_events (loan_id, event_type);
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_loan_events_created_at
      ON loan_events (created_at);
  `);
};

/**
 * Keep rollback non-destructive because several indexes above may already
 * exist from prior migrations with shared names.
 *
 * @returns {void}
 */
export const down = () => {};
