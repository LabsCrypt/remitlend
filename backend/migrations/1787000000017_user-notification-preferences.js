/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable('user_notification_preferences', {
    user_id: {
      type: 'varchar(255)',
      notNull: true,
      primaryKey: true,
      references: '"user_profiles"("public_key")',
      onDelete: 'CASCADE',
    },
    email_enabled: { type: 'boolean', notNull: true, default: false },
    sms_enabled: { type: 'boolean', notNull: true, default: false },
    phone: { type: 'varchar(20)' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('user_notification_preferences');
};
