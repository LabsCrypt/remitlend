/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable("webhook_subscriptions", {
    id: "id",
    callback_url: { type: "text", notNull: true },
    event_types: { type: "jsonb", notNull: true, default: "[]::jsonb" },
    secret: { type: "varchar(255)" },
    is_active: { type: "boolean", notNull: true, default: true },
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

  pgm.createTable("webhook_deliveries", {
    id: "id",
    subscription_id: {
      type: "integer",
      notNull: true,
      references: "webhook_subscriptions",
      onDelete: "CASCADE",
    },
    event_id: { type: "varchar(255)", notNull: true },
    event_type: { type: "varchar(50)", notNull: true },
    attempt_count: { type: "integer", notNull: true, default: 0 },
    last_status_code: { type: "integer" },
    last_error: { type: "text" },
    delivered_at: { type: "timestamp" },
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

  pgm.createIndex("webhook_subscriptions", "is_active");
  pgm.createIndex("webhook_deliveries", "event_id");
  pgm.createIndex("webhook_deliveries", "subscription_id");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable("webhook_deliveries");
  pgm.dropTable("webhook_subscriptions");
};
