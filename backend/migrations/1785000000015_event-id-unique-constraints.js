/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

const eventIdTables = [
  {
    table: "loan_events",
    indexName: "loan_events_event_id_unique_idx",
  },
  {
    table: "indexed_events",
    indexName: "indexed_events_event_id_unique_idx",
  },
  {
    table: "quarantine_events",
    indexName: "quarantine_events_event_id_unique_idx",
  },
];

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
export const up = (pgm) => {
  for (const { table, indexName } of eventIdTables) {
    pgm.sql(`
      DELETE FROM ${table} current_row
      USING ${table} duplicate_row
      WHERE current_row.event_id = duplicate_row.event_id
        AND current_row.id > duplicate_row.id;
    `);

    pgm.sql(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_indexes
          WHERE schemaname = current_schema()
            AND tablename = '${table}'
            AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
            AND indexdef LIKE '%(event_id)%'
        ) THEN
          EXECUTE 'CREATE UNIQUE INDEX ${indexName} ON ${table} (event_id)';
        END IF;
      END
      $$;
    `);
  }
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
export const down = (pgm) => {
  for (const { indexName } of eventIdTables) {
    pgm.sql(`DROP INDEX IF EXISTS ${indexName}`);
  }
};
