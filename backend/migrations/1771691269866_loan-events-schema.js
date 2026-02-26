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
  pgm.createTable("loan_events", {
    id: "id",
    event_id: { type: "varchar(255)", notNull: true, unique: true },
    event_type: { type: "varchar(50)", notNull: true },
    loan_id: { type: "integer" },
    borrower: { type: "varchar(255)", notNull: true },
    amount: { type: "numeric" },
    ledger: { type: "integer", notNull: true },
    ledger_closed_at: { type: "timestamp", notNull: true },
    tx_hash: { type: "varchar(255)", notNull: true },
    contract_id: { type: "varchar(255)", notNull: true },
    topics: { type: "jsonb" },
    value: { type: "text" },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  pgm.createIndex("loan_events", "event_type");
  pgm.createIndex("loan_events", "borrower");
  pgm.createIndex("loan_events", "loan_id");
  pgm.createIndex("loan_events", "ledger");
  pgm.createIndex("loan_events", "tx_hash");

  // Table to track indexer state
  pgm.createTable("indexer_state", {
    id: "id",
    last_indexed_ledger: { type: "integer", notNull: true, default: 0 },
    last_indexed_cursor: { type: "varchar(255)" },
    updated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  // Insert initial state
  pgm.sql(`
    INSERT INTO indexer_state (last_indexed_ledger)
    VALUES (0)
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable("indexer_state");
  pgm.dropTable("loan_events");
};
