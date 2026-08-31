/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.addColumns('user_notification_preferences', {
    per_type_overrides: {
      type: 'jsonb',
      notNull: true,
      default: "'{}'",
      comment: 'Per-notification-type overrides, e.g. {"repayment_due": true}',
    },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropColumns('user_notification_preferences', ['per_type_overrides']);
};
