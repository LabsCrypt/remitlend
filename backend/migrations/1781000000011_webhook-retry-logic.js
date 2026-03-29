/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // Add payload column to webhook_deliveries table
  pgm.addColumn("webhook_deliveries", {
    payload: {
      type: "jsonb",
      notNull: false,
    },
  });

  // Add next_retry_at column to track when to retry
  pgm.addColumn("webhook_deliveries", {
    next_retry_at: {
      type: "timestamp",
      notNull: false,
    },
  });

  // Add index for efficient retry polling
  pgm.createIndex("webhook_deliveries", ["next_retry_at"], {
    where: "next_retry_at IS NOT NULL AND delivered_at IS NULL",
  });

  // Add index for subscription + event tracking
  pgm.createIndex("webhook_deliveries", ["subscription_id", "event_id"]);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropIndex("webhook_deliveries", ["subscription_id", "event_id"]);
  pgm.dropIndex("webhook_deliveries", ["next_retry_at"]);
  pgm.dropColumn("webhook_deliveries", "next_retry_at");
  pgm.dropColumn("webhook_deliveries", "payload");
};
