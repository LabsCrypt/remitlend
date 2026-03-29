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
  pgm.createTable("notifications", {
    id: "id",
    user_id: { type: "varchar(255)", notNull: true },
    type: {
      type: "varchar(50)",
      notNull: true,
      comment:
        "loan_approved | repayment_due | repayment_confirmed | loan_defaulted | score_changed",
    },
    title: { type: "varchar(255)", notNull: true },
    message: { type: "text", notNull: true },
    loan_id: { type: "integer", notNull: false },
    read: { type: "boolean", notNull: true, default: false },
    created_at: {
      type: "timestamp",
      notNull: true,
      default: pgm.func("current_timestamp"),
    },
  });

  pgm.createIndex("notifications", "user_id");
  pgm.createIndex("notifications", "read");
  pgm.createIndex("notifications", ["user_id", "read"]);
  pgm.createIndex("notifications", "created_at");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable("notifications");
};
