// 1784000000014_add_loan_events_indexes.js

export async function up(knex) {
  await knex.raw(`
    -- Index for borrower history queries
    CREATE INDEX IF NOT EXISTS loan_events_borrower_idx
    ON loan_events (borrower_id);

    -- Index for loan status queries
    CREATE INDEX IF NOT EXISTS loan_events_status_idx
    ON loan_events (loan_id, status);
  `);
}

export async function down(knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS loan_events_borrower_idx;
    DROP INDEX IF EXISTS loan_events_status_idx;
  `);
}
