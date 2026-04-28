/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
export const up = (pgm) => {
  // 1. Rename the table
  pgm.renameTable("loan_events", "contract_events");

  // 2. Rename the column (Postgres handles index column updates automatically)
  pgm.renameColumn("contract_events", "borrower", "address");

  // 3. Make address nullable (for events like YieldDistributed that may not have a user address)
  pgm.alterColumn("contract_events", "address", { notNull: false });

  // 4. Rename indexes to match the new table and column names
  pgm.renameIndex(
    "contract_events",
    "idx_loan_events_borrower_event_type",
    "idx_contract_events_address_event_type",
  );
  pgm.renameIndex(
    "contract_events",
    "idx_loan_events_loan_id_event_type",
    "idx_contract_events_loan_id_event_type",
  );
  pgm.renameIndex(
    "contract_events",
    "idx_loan_events_event_type_loan_id",
    "idx_contract_events_event_type_loan_id",
  );
  pgm.renameIndex(
    "contract_events",
    "idx_loan_events_ledger",
    "idx_contract_events_ledger",
  );
  pgm.renameIndex(
    "contract_events",
    "idx_loan_events_pool_deposits_withdraws",
    "idx_contract_events_pool_deposits_withdraws",
  );

  // Rename single-column indexes from initial schema (if they exist)
  pgm.sql(`
    ALTER INDEX IF EXISTS loan_events_event_type_index RENAME TO contract_events_event_type_index;
    ALTER INDEX IF EXISTS loan_events_borrower_index RENAME TO contract_events_address_index;
    ALTER INDEX IF EXISTS loan_events_loan_id_index RENAME TO contract_events_loan_id_index;
    ALTER INDEX IF EXISTS loan_events_ledger_index RENAME TO contract_events_ledger_index;
    ALTER INDEX IF EXISTS loan_events_tx_hash_index RENAME TO contract_events_tx_hash_index;
  `);

  // 5. Create a view for backward compatibility with existing code that still queries 'loan_events'
  pgm.sql(`
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
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
export const down = (pgm) => {
  pgm.sql("DROP VIEW IF EXISTS loan_events");

  pgm.renameColumn("contract_events", "address", "borrower");
  pgm.alterColumn("contract_events", "borrower", { notNull: true });

  pgm.renameTable("contract_events", "loan_events");

  // Revert index names
  pgm.renameIndex(
    "loan_events",
    "idx_contract_events_address_event_type",
    "idx_loan_events_borrower_event_type",
  );
  pgm.renameIndex(
    "loan_events",
    "idx_contract_events_loan_id_event_type",
    "idx_loan_events_loan_id_event_type",
  );
  pgm.renameIndex(
    "loan_events",
    "idx_contract_events_event_type_loan_id",
    "idx_loan_events_event_type_loan_id",
  );
  pgm.renameIndex(
    "loan_events",
    "idx_contract_events_ledger",
    "idx_loan_events_ledger",
  );
  pgm.renameIndex(
    "loan_events",
    "idx_contract_events_pool_deposits_withdraws",
    "idx_loan_events_pool_deposits_withdraws",
  );

  pgm.sql(`
    ALTER INDEX IF EXISTS contract_events_event_type_index RENAME TO loan_events_event_type_index;
    ALTER INDEX IF EXISTS contract_events_address_index RENAME TO loan_events_borrower_index;
    ALTER INDEX IF EXISTS contract_events_loan_id_index RENAME TO loan_events_loan_id_index;
    ALTER INDEX IF EXISTS contract_events_ledger_index RENAME TO loan_events_ledger_index;
    ALTER INDEX IF EXISTS contract_events_tx_hash_index RENAME TO loan_events_tx_hash_index;
  `);
};
