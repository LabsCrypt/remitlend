/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * Score-range hardening: clamp any legacy out-of-range scores then add a CHECK
 * constraint to block invalid manual updates. Lives here (rather than inside
 * the initial-schema migration) because the rename `current_score → score`
 * happens later in `1789000000000_ensure-core-tables.js`.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = async (pgm) => {
  await pgm.sql(`
    UPDATE scores
    SET score = LEAST(850, GREATEST(300, score))
    WHERE score < 300 OR score > 850;
  `);

  await pgm.sql(`
    ALTER TABLE scores
    ADD CONSTRAINT chk_score_range
    CHECK (score BETWEEN 300 AND 850);
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = async (pgm) => {
  await pgm.sql(`
    ALTER TABLE scores
    DROP CONSTRAINT IF EXISTS chk_score_range;
  `);
};
