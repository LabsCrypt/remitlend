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
  pgm.createTable("loan_history", {
    id: "id",
    loan_id: { type: "integer", notNull: true },
    borrower_public_key: { type: "varchar(255)", notNull: true },
    lender_public_key: { type: "varchar(255)" },
    principal_amount: { type: "numeric", notNull: true },
    interest_rate_bps: { type: "integer", notNull: true },
    principal_paid: { type: "numeric", default: 0 },
    interest_paid: { type: "numeric", default: 0 },
    accrued_interest: { type: "numeric", default: 0 },
    status: { type: "varchar(50)", notNull: true },
    due_date: { type: "timestamp" },
    requested_at: { type: "timestamp" },
    approved_at: { type: "timestamp" },
    repaid_at: { type: "timestamp" },
    defaulted_at: { type: "timestamp" },
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
    metadata: { type: "jsonb" },
  });

  pgm.createIndex("loan_history", "loan_id");
  pgm.createIndex("loan_history", "borrower_public_key");
  pgm.createIndex("loan_history", "lender_public_key");
  pgm.createIndex("loan_history", "status");
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable("loan_history");
};
