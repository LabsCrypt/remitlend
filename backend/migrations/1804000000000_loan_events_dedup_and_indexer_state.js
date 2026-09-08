/**
 * Migration: loan_events dedup, indexer_state last_tx_hash, and ledger_reconciliation_reports
 *
 * Enforces UNIQUE (tx_hash, event_index) on contract_events so ingestion
 * with ON CONFLICT DO NOTHING is idempotent.
 * Adds last_tx_hash to indexer_state for atomic cursor advance.
 * Creates ledger_reconciliation_reports table for ledgerReconciler.ts.
 */

export const shorthands = undefined;

export const up = (pgm) => {
  // 1. Add event_index column to contract_events if it doesn't exist
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'contract_events') THEN
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'contract_events' AND column_name = 'event_index'
        ) THEN
          ALTER TABLE contract_events ADD COLUMN event_index INTEGER NOT NULL DEFAULT 0;
        END IF;

        -- Clean up any duplicates before applying unique constraint
        DELETE FROM contract_events ce
        USING (
          SELECT id
          FROM (
            SELECT
              id,
              ROW_NUMBER() OVER (
                PARTITION BY tx_hash, event_index
                ORDER BY id ASC
              ) AS row_num
            FROM contract_events
            WHERE tx_hash IS NOT NULL
          ) ranked
          WHERE ranked.row_num > 1
        ) duplicates
        WHERE ce.id = duplicates.id;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint 
          WHERE conname = 'uq_contract_events_tx_hash_event_index'
        ) THEN
          ALTER TABLE contract_events 
          ADD CONSTRAINT uq_contract_events_tx_hash_event_index 
          UNIQUE (tx_hash, event_index);
        END IF;
      ELSIF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'loan_events') THEN
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'loan_events' AND column_name = 'event_index'
        ) THEN
          ALTER TABLE loan_events ADD COLUMN event_index INTEGER NOT NULL DEFAULT 0;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint 
          WHERE conname = 'uq_loan_events_tx_hash_event_index'
        ) THEN
          ALTER TABLE loan_events 
          ADD CONSTRAINT uq_loan_events_tx_hash_event_index 
          UNIQUE (tx_hash, event_index);
        END IF;
      END IF;
    END $$;
  `);

  // 2. Update loan_events view to expose event_index
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT FROM pg_views WHERE schemaname = 'public' AND viewname = 'loan_events') THEN
        DROP VIEW IF EXISTS loan_events;
        CREATE VIEW loan_events AS
        SELECT
          id,
          event_id,
          event_type,
          loan_id,
          address,
          address AS borrower,
          amount,
          interest_rate_bps,
          term_ledgers,
          ledger,
          ledger_closed_at,
          tx_hash,
          event_index,
          contract_id,
          topics,
          value,
          created_at
        FROM contract_events;
      END IF;
    END $$;
  `);

  // 3. Add last_tx_hash to indexer_state
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'indexer_state') THEN
        IF NOT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'indexer_state' AND column_name = 'last_tx_hash'
        ) THEN
          ALTER TABLE indexer_state ADD COLUMN last_tx_hash VARCHAR(255);
        END IF;
      END IF;
    END $$;
  `);

  // 4. Create ledger_reconciliation_reports table
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS ledger_reconciliation_reports (
      id SERIAL PRIMARY KEY,
      contract_id TEXT NOT NULL,
      ledger_seq BIGINT NOT NULL,
      drift_count INTEGER NOT NULL DEFAULT 0,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      auto_healed BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_reconciliation_contract_ledger ON ledger_reconciliation_reports (contract_id, ledger_seq);
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS ledger_reconciliation_reports;

    DO $$
    BEGIN
      IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'indexer_state') THEN
        ALTER TABLE indexer_state DROP COLUMN IF EXISTS last_tx_hash;
      END IF;

      IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'contract_events') THEN
        ALTER TABLE contract_events DROP CONSTRAINT IF EXISTS uq_contract_events_tx_hash_event_index;
        ALTER TABLE contract_events DROP COLUMN IF EXISTS event_index;
      END IF;

      IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'loan_events') THEN
        ALTER TABLE loan_events DROP CONSTRAINT IF EXISTS uq_loan_events_tx_hash_event_index;
        ALTER TABLE loan_events DROP COLUMN IF EXISTS event_index;
      END IF;

      IF EXISTS (SELECT FROM pg_views WHERE schemaname = 'public' AND viewname = 'loan_events') THEN
        DROP VIEW IF EXISTS loan_events;
        CREATE VIEW loan_events AS
        SELECT
          id,
          event_id,
          event_type,
          loan_id,
          address,
          address AS borrower,
          amount,
          interest_rate_bps,
          term_ledgers,
          ledger,
          ledger_closed_at,
          tx_hash,
          contract_id,
          topics,
          value,
          created_at
        FROM contract_events;
      END IF;
    END $$;
  `);
};
