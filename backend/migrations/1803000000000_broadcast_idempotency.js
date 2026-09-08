/**
 * Migration: Create broadcast_idempotency table
 *
 * Prevents re-execution of batch operations across layers.
 * op_key = ${contract_id}:${op_kind}:${nonce}
 * Tracks status: 'pending', 'submitted', 'applied', 'failed'
 */

export const shorthands = undefined;

export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS broadcast_idempotency (
      op_key TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      nonce BIGINT NOT NULL,
      tx_hash TEXT,
      ledger_seq BIGINT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'submitted', 'applied', 'failed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_broadcast_idempotency_batch_id ON broadcast_idempotency (batch_id);
    CREATE INDEX IF NOT EXISTS idx_broadcast_idempotency_status ON broadcast_idempotency (status);
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS broadcast_idempotency;
  `);
};
