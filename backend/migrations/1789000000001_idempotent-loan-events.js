/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  // First, clean up any existing duplicates that would violate the new constraint.
  // We keep the one with the smallest id (the one indexed first).
  pgm.sql(`
    DELETE FROM contract_events le
    USING (
      SELECT id
      FROM (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY loan_id, event_type, ledger
            ORDER BY id ASC
          ) AS row_num
        FROM contract_events
        WHERE loan_id IS NOT NULL
      ) ranked
      WHERE ranked.row_num > 1
    ) duplicates
    WHERE le.id = duplicates.id
  `);

  // Add the unique constraint.
  // Note: We apply it to contract_events as loan_events is often a view pointing to it.
  // If loan_events is a table, we apply it there instead.
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'contract_events') THEN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint 
          WHERE conname = 'uq_contract_events_loan_type_ledger'
        ) THEN
          ALTER TABLE contract_events 
          ADD CONSTRAINT uq_contract_events_loan_type_ledger 
          UNIQUE (loan_id, event_type, ledger);
        END IF;
      ELSIF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'loan_events') THEN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint 
          WHERE conname = 'uq_loan_events_loan_type_ledger'
        ) THEN
          ALTER TABLE loan_events 
          ADD CONSTRAINT uq_loan_events_loan_type_ledger 
          UNIQUE (loan_id, event_type, ledger);
        END IF;
      END IF;
    END $$;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE IF EXISTS contract_events DROP CONSTRAINT IF EXISTS uq_contract_events_loan_type_ledger;
    ALTER TABLE IF EXISTS loan_events DROP CONSTRAINT IF EXISTS uq_loan_events_loan_type_ledger;
  `);
};
