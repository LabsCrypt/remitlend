/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // Add indexer_name column to track state per contract/indexer instance
  pgm.addColumns("indexer_state", {
    indexer_name: { type: "varchar(255)", notNull: true, default: "default" },
  });

  // Migrate existing record to 'loan_manager'
  pgm.sql("UPDATE indexer_state SET indexer_name = 'loan_manager' WHERE id = 1");

  // Ensure indexer_name is unique
  pgm.addConstraint("indexer_state", "indexer_state_indexer_name_unique", {
    unique: "indexer_name",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropConstraint("indexer_state", "indexer_state_indexer_name_unique");
  pgm.dropColumns("indexer_state", ["indexer_name"]);
};
