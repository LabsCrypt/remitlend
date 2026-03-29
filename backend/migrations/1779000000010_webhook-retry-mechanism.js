/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.addColumns("webhook_subscriptions", {
    max_attempts: { type: "integer", notNull: true, default: 5 },
  });

  pgm.addColumns("webhook_deliveries", {
    payload: { type: "jsonb" },
    next_retry_at: { type: "timestamp" },
  });

  pgm.createIndex("webhook_deliveries", ["delivered_at", "next_retry_at", "attempt_count"]);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropColumns("webhook_deliveries", ["payload", "next_retry_at"]);
  pgm.dropColumns("webhook_subscriptions", ["max_attempts"]);
};
