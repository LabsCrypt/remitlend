/**
 * Ensure loan_events has an index whose leading key is loan_id.
 * If one already exists (single-column or composite), this migration is a no-op.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND tablename = 'loan_events'
          AND indexdef ILIKE '%(loan_id%'
      ) THEN
        CREATE INDEX idx_loan_events_loan_id ON loan_events (loan_id);
      END IF;
    END
    $$;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql("DROP INDEX IF EXISTS idx_loan_events_loan_id;");
};
