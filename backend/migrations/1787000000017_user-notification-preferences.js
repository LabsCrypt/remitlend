/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.addColumns("user_profiles", {
    email_enabled: { type: "boolean", notNull: true, default: false },
    sms_enabled: { type: "boolean", notNull: true, default: false },
    phone: { type: "varchar(20)" },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropColumns("user_profiles", ["email_enabled", "sms_enabled", "phone"]);
};
