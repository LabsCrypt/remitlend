/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // Keep only the earliest LoanApproved event per loan before enforcing uniqueness.
  pgm.sql(`
    DELETE FROM loan_events le
    USING (
      SELECT id
      FROM (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY loan_id
            ORDER BY ledger ASC, id ASC
          ) AS row_num
        FROM loan_events
        WHERE loan_id IS NOT NULL
          AND event_type = 'LoanApproved'
      ) ranked
      WHERE ranked.row_num > 1
    ) duplicates
    WHERE le.id = duplicates.id
  `);

  // Some environments may have missed the broader status-event index rollout.
  // In that case, enforce LoanApproved uniqueness directly.
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = 'loan_events_unique_status_event_per_loan'
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = 'loan_events_unique_approved_event_per_loan'
      ) THEN
        CREATE UNIQUE INDEX loan_events_unique_approved_event_per_loan
        ON loan_events (loan_id)
        WHERE loan_id IS NOT NULL
          AND event_type = 'LoanApproved';
      END IF;
    END $$;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql("DROP INDEX IF EXISTS loan_events_unique_approved_event_per_loan");
};
