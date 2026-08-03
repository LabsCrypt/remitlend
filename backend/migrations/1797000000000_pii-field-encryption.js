/**
 * PII Field Encryption Migration
 *
 * Adds encrypted PII infrastructure:
 * - pii_access_log table for decrypt audit trail
 *
 * This migration does NOT modify existing tables with PII columns
 * since the current schema stores recipient data as Stellar addresses
 * (public keys), not plaintext PII. It establishes the infrastructure
 * for when PII fields are added.
 */

/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable('pii_access_log', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    actor: {
      type: 'text',
      notNull: true,
    },
    record_id: {
      type: 'text',
      notNull: true,
    },
    field: {
      type: 'text',
      notNull: true,
    },
    reason: {
      type: 'text',
      notNull: true,
    },
    request_id: {
      type: 'text',
      notNull: true,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
  });

  pgm.createIndex('pii_access_log', ['record_id', 'created_at'], {
    name: 'idx_pii_access_log_record_created',
  });

  pgm.createIndex('pii_access_log', ['actor', 'created_at'], {
    name: 'idx_pii_access_log_actor_created',
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('pii_access_log');
};
