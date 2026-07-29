/**
 * Migration: Signed, ordered, exactly-once webhook delivery infrastructure.
 *
 * Adds:
 *   webhook_events        — canonical immutable event store, keyed by
 *                           canonical_event_id derived from
 *                           (ledger_sequence, tx_hash, event_index).
 *   webhook_signing_keys  — HMAC secrets per subscription, supporting rotation
 *                           via active | retiring | revoked states.
 *   Columns on webhook_deliveries:
 *     canonical_event_id  — FK → webhook_events, enables idempotent delivery.
 *     subscription_sequence — monotonic gap-free integer per subscription,
 *                             assigned at delivery creation time.
 *     status              — pending | inflight | delivered | failed | dead.
 *     key_id              — which signing key was used for this delivery.
 *     nonce               — per-delivery nonce for replay window checks.
 *
 * Related to Issue #1383: Signed, Ordered, Exactly-Once Webhook Delivery.
 */

export const shorthands = undefined;

export const up = async (pgm) => {
  // ── webhook_events: canonical immutable event store ────────────────────────
  pgm.createTable('webhook_events', {
    id: 'id',
    canonical_event_id: {
      type: 'varchar(255)',
      notNull: true,
      unique: true,
      comment: 'Stable: sha256(ledger_sequence || ":" || tx_hash || ":" || event_index)',
    },
    ledger_sequence: { type: 'bigint', notNull: true },
    tx_hash: { type: 'varchar(255)', notNull: true },
    event_index: { type: 'integer', notNull: false },
    event_type: { type: 'varchar(100)', notNull: true },
    contract_id: { type: 'varchar(255)', notNull: false },
    payload: { type: 'jsonb', notNull: true },
    ingested_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createIndex('webhook_events', 'canonical_event_id');
  pgm.createIndex('webhook_events', 'ledger_sequence');
  pgm.createIndex('webhook_events', 'event_type');

  // ── webhook_signing_keys: per-subscription HMAC keys ──────────────────────
  pgm.createTable('webhook_signing_keys', {
    id: 'id',
    subscription_id: {
      type: 'integer',
      notNull: true,
      references: 'webhook_subscriptions',
      onDelete: 'CASCADE',
    },
    key_id: {
      type: 'varchar(64)',
      notNull: true,
      unique: true,
      comment: 'Public identifier; included in X-Webhook-Key-Id header.',
    },
    // Secret is stored hashed (PBKDF2) — never returned via API.
    // The raw value is used only at signing time and discarded immediately.
    secret_hash: { type: 'text', notNull: true },
    algorithm: { type: 'varchar(32)', notNull: true, default: "'hmac-sha256'" },
    state: {
      type: 'varchar(16)',
      notNull: true,
      default: "'active'",
      comment: 'active | retiring | revoked',
    },
    created_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    retired_at: { type: 'timestamp with time zone' },
    revoked_at: { type: 'timestamp with time zone' },
  });

  pgm.createIndex('webhook_signing_keys', 'subscription_id');
  pgm.createIndex('webhook_signing_keys', ['subscription_id', 'state']);

  // ── webhook_deliveries: extend existing table ──────────────────────────────
  pgm.sql(`
    ALTER TABLE webhook_deliveries
      ADD COLUMN IF NOT EXISTS canonical_event_id VARCHAR(255)
        REFERENCES webhook_events(canonical_event_id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS subscription_sequence BIGINT,
      ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','inflight','delivered','failed','dead')),
      ADD COLUMN IF NOT EXISTS key_id VARCHAR(64),
      ADD COLUMN IF NOT EXISTS nonce VARCHAR(64);
  `);

  // Exactly-once: only one delivery row per (subscription_id, canonical_event_id).
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS webhook_deliveries_sub_event_uniq
      ON webhook_deliveries (subscription_id, canonical_event_id)
      WHERE canonical_event_id IS NOT NULL;
  `);

  // Ordered advancement query index: find the lowest un-acknowledged sequence
  // for a subscription efficiently.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS webhook_deliveries_sub_seq_status
      ON webhook_deliveries (subscription_id, subscription_sequence)
      WHERE status NOT IN ('delivered', 'dead');
  `);

  // Per-subscription sequence counter table — one row per subscription.
  // Incrementing is done with SELECT ... FOR UPDATE to guarantee gap-free
  // monotonic assignment within a single transaction.
  pgm.createTable('webhook_subscription_sequences', {
    subscription_id: {
      type: 'integer',
      primaryKey: true,
      references: 'webhook_subscriptions',
      onDelete: 'CASCADE',
    },
    last_sequence: { type: 'bigint', notNull: true, default: 0 },
    updated_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  // Nonce store for replay-window deduplication (TTL'd by replay_window_seconds).
  pgm.createTable('webhook_nonces', {
    id: 'id',
    subscription_id: {
      type: 'integer',
      notNull: true,
      references: 'webhook_subscriptions',
      onDelete: 'CASCADE',
    },
    nonce: { type: 'varchar(64)', notNull: true },
    used_at: {
      type: 'timestamp with time zone',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS webhook_nonces_sub_nonce_uniq
      ON webhook_nonces (subscription_id, nonce);
    CREATE INDEX IF NOT EXISTS webhook_nonces_used_at
      ON webhook_nonces (used_at);
  `);
};

export const down = async (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS webhook_nonces_used_at;`);
  pgm.sql(`DROP INDEX IF EXISTS webhook_nonces_sub_nonce_uniq;`);
  pgm.dropTable('webhook_nonces', { ifExists: true });
  pgm.dropTable('webhook_subscription_sequences', { ifExists: true });
  pgm.sql(`DROP INDEX IF EXISTS webhook_deliveries_sub_seq_status;`);
  pgm.sql(`DROP INDEX IF EXISTS webhook_deliveries_sub_event_uniq;`);
  pgm.sql(`
    ALTER TABLE webhook_deliveries
      DROP COLUMN IF EXISTS canonical_event_id,
      DROP COLUMN IF EXISTS subscription_sequence,
      DROP COLUMN IF EXISTS status,
      DROP COLUMN IF EXISTS key_id,
      DROP COLUMN IF EXISTS nonce;
  `);
  pgm.dropTable('webhook_signing_keys', { ifExists: true });
  pgm.dropTable('webhook_events', { ifExists: true });
};
