/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable("audit_logs", {
    id: "id",
    actor: { type: "varchar(255)", notNull: true },
    action: { type: "varchar(255)", notNull: true },
    target: { type: "varchar(255)", notNull: false },
    payload: { type: "jsonb", notNull: false },
    ip_address: { type: "varchar(50)", notNull: false },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  pgm.createIndex("audit_logs", "actor");
  pgm.createIndex("audit_logs", "action");
  pgm.createIndex("audit_logs", "created_at");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable("audit_logs");
};
