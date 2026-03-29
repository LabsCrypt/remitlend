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
  pgm.createTable("remittances", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    sender_id: {
      type: "varchar(56)",
      notNull: true,
    },
    recipient_address: {
      type: "varchar(56)",
      notNull: true,
    },
    amount: {
      type: "numeric(20,7)",
      notNull: true,
    },
    from_currency: {
      type: "varchar(10)",
      notNull: true,
    },
    to_currency: {
      type: "varchar(10)",
      notNull: true,
    },
    memo: {
      type: "varchar(28)",
      allowNull: true,
    },
    status: {
      type: "varchar(20)",
      notNull: true,
      default: "pending",
      check: "status IN ('pending', 'processing', 'completed', 'failed')",
    },
    transaction_hash: {
      type: "varchar(64)",
      allowNull: true,
    },
    xdr: {
      type: "text",
      notNull: true,
    },
    error_message: {
      type: "text",
      allowNull: true,
    },
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

  // Indexes for common queries
  pgm.createIndex("remittances", "sender_id");
  pgm.createIndex("remittances", ["sender_id", "status"]);
  pgm.createIndex("remittances", "created_at");
  pgm.createIndex("remittances", "transaction_hash");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable("remittances");
};
