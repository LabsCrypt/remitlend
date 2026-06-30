// Migration: Add loan_disputes table and support for disputed loan status.
// Uses node-pg-migrate's pgm.sql instead of the foreign db.query API the
// original CJS module was written against.

export const up = (pgm) => {
  // loan_id is the on-chain loan identifier. loan_events has many rows per
  // loan, so a FK there would require a unique constraint Postgres can't
  // satisfy. Store the id as a plain integer and index it for lookup.
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS loan_disputes (
      id SERIAL PRIMARY KEY,
      loan_id INTEGER NOT NULL,
      borrower TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      admin_note TEXT,
      resolution TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      resolved_at TIMESTAMP WITH TIME ZONE
    );
  `);

  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_loan_disputes_status ON loan_disputes(status);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_loan_disputes_borrower ON loan_disputes(borrower);`);
  pgm.sql(`CREATE INDEX IF NOT EXISTS idx_loan_disputes_loan_id ON loan_disputes(loan_id);`);
};

export const down = (pgm) => {
  pgm.sql(`DROP TABLE IF EXISTS loan_disputes;`);
};
