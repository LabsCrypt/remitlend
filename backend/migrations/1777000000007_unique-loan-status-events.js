/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // Keep the earliest status event per (loan_id, event_type) before enforcing uniqueness.
  pgm.sql(`
    DELETE FROM loan_events le
    USING (
      SELECT id
      FROM (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY loan_id, event_type
            ORDER BY ledger ASC, id ASC
          ) AS row_num
        FROM loan_events
        WHERE loan_id IS NOT NULL
          AND event_type IN ('LoanApproved', 'LoanDefaulted')
      ) ranked
      WHERE ranked.row_num > 1
    ) duplicates
    WHERE le.id = duplicates.id
  `);

  pgm.sql(`
    CREATE UNIQUE INDEX loan_events_unique_status_event_per_loan
    ON loan_events (loan_id, event_type)
    WHERE loan_id IS NOT NULL
      AND event_type IN ('LoanApproved', 'LoanDefaulted')
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql("DROP INDEX IF EXISTS loan_events_unique_status_event_per_loan");
};
