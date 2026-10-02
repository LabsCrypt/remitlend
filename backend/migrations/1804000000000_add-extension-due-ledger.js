/**
 * Stores the absolute due ledger emitted by LoanExtended events. Keeping this
 * separately from term_ledgers preserves the meaning of LoanApproved data.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
export const up = (pgm) => {
  pgm.addColumn('contract_events', {
    due_ledger: { type: 'integer' },
  });
  pgm.createIndex('contract_events', 'id', {
    name: 'idx_contract_events_legacy_extensions_due_ledger',
    where: "event_type = 'LoanExtended' AND due_ledger IS NULL",
  });

  pgm.sql(`
    CREATE OR REPLACE VIEW loan_events AS
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
      created_at,
      due_ledger
    FROM contract_events;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql('DROP VIEW IF EXISTS loan_events;');
  pgm.dropIndex('contract_events', 'id', {
    name: 'idx_contract_events_legacy_extensions_due_ledger',
  });
  pgm.sql(`
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
  `);
  pgm.dropColumn('contract_events', 'due_ledger');
};
