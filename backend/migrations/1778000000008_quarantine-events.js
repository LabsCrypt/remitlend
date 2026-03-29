/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Creates the `quarantine_events` table to store malformed Soroban contract
 * events that fail parsing in the EventIndexer.
 *
 * When an event cannot be parsed (e.g. a string where a u32 is expected),
 * the raw XDR is preserved here for manual review and debugging instead of
 * being silently discarded.
 *
 * Columns
 * -------
 * event_id       — Soroban event ID from the RPC response (unique per event)
 * ledger         — Ledger sequence number the event was emitted in
 * tx_hash        — Transaction hash that produced the event
 * contract_id    — Contract address that emitted the event
 * raw_xdr        — Full event payload serialised as JSON with base64-encoded
 *                  topic and value XDR fields for offline debugging
 * error_message  — Human-readable description of why parsing failed
 * quarantined_at — Timestamp of when the event was quarantined
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
export const up = (pgm) => {
  pgm.createTable("quarantine_events", {
    id: { type: "serial", primaryKey: true },
    event_id: { type: "varchar(255)", notNull: true, unique: true },
    ledger: { type: "integer", notNull: true },
    tx_hash: { type: "varchar(255)", notNull: true },
    contract_id: { type: "varchar(255)", notNull: true },
    raw_xdr: { type: "jsonb", notNull: true },
    error_message: { type: "text", notNull: true },
    quarantined_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  pgm.createIndex("quarantine_events", "ledger");
  pgm.createIndex("quarantine_events", "quarantined_at");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
export const down = (pgm) => {
  pgm.dropTable("quarantine_events");
};
