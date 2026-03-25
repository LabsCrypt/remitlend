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
  pgm.createTable("indexed_events", {
    id: "id",
    event_id: { type: "varchar(255)", notNull: true, unique: true },
    event_type: { type: "varchar(50)", notNull: true },
    contract_id: { type: "varchar(255)", notNull: true },
    tx_hash: { type: "varchar(255)", notNull: true },
    ledger: { type: "integer", notNull: true },
    ledger_closed_at: { type: "timestamp", notNull: true },
    topics: { type: "jsonb" },
    value: { type: "text" },
    processed: { type: "boolean", notNull: true, default: false },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
    updated_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  pgm.createIndex("indexed_events", "event_type");
  pgm.createIndex("indexed_events", "contract_id");
  pgm.createIndex("indexed_events", "ledger");
  pgm.createIndex("indexed_events", "tx_hash");
  pgm.createIndex("indexed_events", "processed");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable("indexed_events");
};
