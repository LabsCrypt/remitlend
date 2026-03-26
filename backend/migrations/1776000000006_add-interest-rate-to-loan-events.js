/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.addColumns("loan_events", {
    interest_rate_bps: { type: "integer" },
    term_ledgers: { type: "integer" },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropColumns("loan_events", ["interest_rate_bps", "term_ledgers"]);
};
