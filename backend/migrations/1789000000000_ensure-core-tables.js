/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  // Ensure scores table matches requested schema
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'scores') THEN
        CREATE TABLE scores (
          id SERIAL PRIMARY KEY,
          borrower VARCHAR(255) NOT NULL UNIQUE,
          score INTEGER NOT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      ELSE
        -- Rename columns if they exist under old names
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'scores' AND column_name = 'user_id') THEN
          ALTER TABLE scores RENAME COLUMN user_id TO borrower;
        END IF;
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'scores' AND column_name = 'current_score') THEN
          ALTER TABLE scores RENAME COLUMN current_score TO score;
        END IF;
      END IF;
    END $$;
  `);

  // Ensure loan_events table matches requested schema
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'loan_events') THEN
        CREATE TABLE loan_events (
          id SERIAL PRIMARY KEY,
          loan_id INTEGER,
          borrower VARCHAR(255) NOT NULL,
          event_type VARCHAR(50) NOT NULL,
          amount NUMERIC,
          ledger INTEGER NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      END IF;
    END $$;
  `);

  // Ensure indexer_state table matches requested schema
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'indexer_state') THEN
        CREATE TABLE indexer_state (
          id SERIAL PRIMARY KEY,
          contract VARCHAR(255) NOT NULL UNIQUE,
          last_ledger INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      ELSE
        -- Rename and add contract column
        IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'indexer_state' AND column_name = 'last_indexed_ledger') THEN
          ALTER TABLE indexer_state RENAME COLUMN last_indexed_ledger TO last_ledger;
        END IF;
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'indexer_state' AND column_name = 'contract') THEN
          ALTER TABLE indexer_state ADD COLUMN contract VARCHAR(255) NOT NULL DEFAULT 'default';
          ALTER TABLE indexer_state ALTER COLUMN contract DROP DEFAULT;
          ALTER TABLE indexer_state ADD CONSTRAINT indexer_state_contract_unique UNIQUE (contract);
        END IF;
      END IF;
    END $$;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  // We don't necessarily want to drop tables in down if they were already there,
  // but for a clean rollback we'll just rename columns back if needed.
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'scores' AND column_name = 'borrower') THEN
        ALTER TABLE scores RENAME COLUMN borrower TO user_id;
      END IF;
      IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'scores' AND column_name = 'score') THEN
        ALTER TABLE scores RENAME COLUMN score TO current_score;
      END IF;
      IF EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'indexer_state' AND column_name = 'last_ledger') THEN
        ALTER TABLE indexer_state RENAME COLUMN last_ledger TO last_indexed_ledger;
      END IF;
    END $$;
  `);
};
