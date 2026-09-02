/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = async (pgm) => {
  // ─── Add seq identity columns for keyset pagination ───────────────────

  // 1. contract_events (formerly loan_events)
  pgm.addColumn('contract_events', {
    seq: {
      type: 'bigserial',
      notNull: true,
      unique: false,
    },
  });

  // Backfill seq for existing rows in (created_at, id) order
  pgm.sql(`
    UPDATE contract_events
    SET seq = (
      SELECT row_number() OVER (ORDER BY created_at ASC, id ASC)
      FROM contract_events AS ce
      WHERE ce.id = contract_events.id
    )
  `);

  // 2. remittances
  pgm.addColumn('remittances', {
    seq: {
      type: 'bigserial',
      notNull: true,
      unique: false,
    },
  });

  // Backfill seq for existing rows in (created_at, id) order
  pgm.sql(`
    UPDATE remittances
    SET seq = (
      SELECT row_number() OVER (ORDER BY created_at ASC, id ASC)
      FROM remittances AS r
      WHERE r.id = remittances.id
    )
  `);

  // 3. loan_disputes (if it exists)
  const disputesTableExists = await pgm.db.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'loan_disputes'
    )
  `);

  if (disputesTableExists.rows[0].exists) {
    pgm.addColumn('loan_disputes', {
      seq: {
        type: 'bigserial',
        notNull: true,
        unique: false,
      },
    });

    pgm.sql(`
      UPDATE loan_disputes
      SET seq = (
        SELECT row_number() OVER (ORDER BY created_at ASC, id ASC)
        FROM loan_disputes AS ld
        WHERE ld.id = loan_disputes.id
      )
    `);
  }

  // ─── Create composite seek indexes ────────────────────────────────────

  // contract_events: (created_at DESC, seq DESC) for keyset pagination
  pgm.createIndex(
    'contract_events',
    [
      { name: 'created_at', direction: 'DESC' },
      { name: 'seq', direction: 'DESC' },
    ],
    {
      name: 'idx_contract_events_seek',
    },
  );

  // remittances: (created_at DESC, seq DESC) for keyset pagination
  pgm.createIndex(
    'remittances',
    [
      { name: 'created_at', direction: 'DESC' },
      { name: 'seq', direction: 'DESC' },
    ],
    {
      name: 'idx_remittances_seek',
    },
  );

  // loan_disputes: (created_at DESC, seq DESC) for keyset pagination (if exists)
  if (disputesTableExists.rows[0].exists) {
    pgm.createIndex(
      'loan_disputes',
      [
        { name: 'created_at', direction: 'DESC' },
        { name: 'seq', direction: 'DESC' },
      ],
      {
        name: 'idx_loan_disputes_seek',
      },
    );
  }
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = async (pgm) => {
  // Drop seek indexes
  pgm.dropIndex('contract_events', [], { name: 'idx_contract_events_seek' });
  pgm.dropIndex('remittances', [], { name: 'idx_remittances_seek' });

  const disputesTableExists = await pgm.db.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'loan_disputes'
    )
  `);

  if (disputesTableExists.rows[0].exists) {
    pgm.dropIndex('loan_disputes', [], { name: 'idx_loan_disputes_seek' });
  }

  // Drop seq columns
  pgm.dropColumn('contract_events', 'seq');
  pgm.dropColumn('remittances', 'seq');

  if (disputesTableExists.rows[0].exists) {
    pgm.dropColumn('loan_disputes', 'seq');
  }
};
