/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * ledger_checkpoints — per-contract record of ledger ranges the indexer has
 * requested from the Soroban RPC, and whether that range's contiguity with
 * the previously-verified range has been confirmed (issue #1376, Phase 2).
 *
 * `status`:
 *   - 'verified': range_start immediately follows the prior verified
 *     range's range_end (no gap detected).
 *   - 'suspect': range_start does NOT immediately follow the prior verified
 *     range's range_end — a ledger range between them was never scanned by
 *     this indexer (see eventIndexer.ts's recordCheckpoint / getSuspectRanges,
 *     and ledgerCheckpoints.ts's hasUnresolvedLedgerGaps).
 *
 * Scoped to gap detection only — this migration does not implement reorg
 * detection (`range_digest` comparison) or backfill, which the full issue
 * spec also calls for; see the PR description for why those are out of
 * scope for this change.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
export const up = (pgm) => {
  pgm.createTable('ledger_checkpoints', {
    id: 'id',
    contract: { type: 'text', notNull: true },
    range_start: { type: 'bigint', notNull: true },
    range_end: { type: 'bigint', notNull: true },
    status: { type: 'text', notNull: true, default: 'verified' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('CURRENT_TIMESTAMP'),
    },
  });

  pgm.addConstraint('ledger_checkpoints', 'ledger_checkpoints_status_check', {
    check: "status IN ('verified', 'suspect')",
  });

  pgm.addConstraint('ledger_checkpoints', 'ledger_checkpoints_range_check', {
    check: 'range_end >= range_start',
  });

  // Every lookup is "give me the most recent range for this contract" or
  // "give me the suspect ranges for this contract" — index both.
  pgm.createIndex('ledger_checkpoints', ['contract', 'range_end'], {
    name: 'idx_ledger_checkpoints_contract_range_end',
  });
  pgm.createIndex('ledger_checkpoints', ['contract', 'status'], {
    name: 'idx_ledger_checkpoints_contract_status',
    where: "status = 'suspect'",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
export const down = (pgm) => {
  pgm.dropTable('ledger_checkpoints');
};
