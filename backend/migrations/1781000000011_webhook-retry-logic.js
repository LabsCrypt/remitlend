/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // payload and next_retry_at are already created by the original
  // webhook-subscriptions migration. Guard with IF NOT EXISTS so a fresh
  // migrate up from an empty schema converges instead of erroring on a
  // duplicate column add.
  pgm.sql(`ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS payload jsonb;`);
  pgm.sql(`ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS next_retry_at timestamp;`);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS webhook_deliveries_next_retry_at_index
      ON webhook_deliveries (next_retry_at)
      WHERE next_retry_at IS NOT NULL AND delivered_at IS NULL;
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS webhook_deliveries_subscription_id_event_id_index
      ON webhook_deliveries (subscription_id, event_id);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  // payload and next_retry_at are owned by the webhook-subscriptions migration;
  // leave them in place on rollback so we don't drop columns we didn't create.
  pgm.sql(`DROP INDEX IF EXISTS webhook_deliveries_subscription_id_event_id_index;`);
  pgm.sql(`DROP INDEX IF EXISTS webhook_deliveries_next_retry_at_index;`);
};
