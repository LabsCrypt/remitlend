/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE scores
    ADD COLUMN IF NOT EXISTS last_decayed_at TIMESTAMP;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE scores
    DROP COLUMN IF EXISTS last_decayed_at;
  `);
};
