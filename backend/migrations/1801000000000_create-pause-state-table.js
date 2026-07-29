/**
 * Migration: Create pause_state table for cross-contract pause coordination
 *
 * This table tracks the global pause state across all Soroban contracts.
 * When any contract emits a PoolPaused or PoolUnpaused event, the eventIndexer
 * updates this table, which is then checked by the pauseGuard middleware to
 * reject state-mutating operations.
 *
 * Related to Issue #1381: Cross-Layer Emergency Pause Propagation
 */

exports.up = async (db) => {
  await db.none(
    `
    CREATE TABLE IF NOT EXISTS pause_state (
      -- Single row table, ID is always 1
      id BIGINT PRIMARY KEY,

      -- Whether contracts are currently paused
      is_paused BOOLEAN NOT NULL DEFAULT false,

      -- Timestamp when pause was activated (NULL if not paused)
      paused_at TIMESTAMP WITH TIME ZONE,

      -- Reason for pause (e.g., "Emergency pause triggered by contract")
      reason TEXT,

      -- Array of contract IDs that are paused
      contracts TEXT[] DEFAULT '{}',

      -- Timestamp of last update
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
    `,
  );

  // Ensure exactly one row exists
  await db.none(
    `
    INSERT INTO pause_state (id, is_paused, paused_at, reason, contracts, updated_at)
    VALUES (1, false, NULL, NULL, '{}', NOW())
    ON CONFLICT (id) DO NOTHING
    `,
  );
};

exports.down = async (db) => {
  await db.none('DROP TABLE IF EXISTS pause_state');
};
