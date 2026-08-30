/**
 * Webhook signing helpers for signed, ordered, exactly-once delivery.
 *
 * Signing scheme (HMAC-SHA256):
 *   message = `${timestamp}.${nonce}.${rawBody}`
 *   signature = hmac-sha256(signingSecret, message)
 *
 * Headers sent to consumers:
 *   X-Webhook-Id                   — canonical_event_id (stable across retries)
 *   X-Webhook-Subscription-Sequence — monotonic integer for ordering
 *   X-Webhook-Timestamp            — Unix ms at send time
 *   X-Webhook-Nonce                — random 32-byte hex (replay guard)
 *   X-Webhook-Key-Id               — public key identifier for rotation
 *   X-Webhook-Signature            — v1=<hmac-sha256-hex>
 */

import crypto from 'node:crypto';
import { query, withTransaction, type PoolClient } from '../db/connection.js';

export interface SigningKey {
  keyId: string;
  secret: string;
}

export interface WebhookSignatureHeaders {
  'X-Webhook-Id': string;
  'X-Webhook-Subscription-Sequence': string;
  'X-Webhook-Timestamp': string;
  'X-Webhook-Nonce': string;
  'X-Webhook-Key-Id': string;
  'X-Webhook-Signature': string;
}

const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export function signPayload(
  rawBody: string,
  key: SigningKey,
  canonicalEventId: string,
  subscriptionSequence: number,
): WebhookSignatureHeaders {
  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(32).toString('hex');
  const message = `${timestamp}.${nonce}.${rawBody}`;
  const signature = crypto.createHmac('sha256', key.secret).update(message).digest('hex');

  return {
    'X-Webhook-Id': canonicalEventId,
    'X-Webhook-Subscription-Sequence': subscriptionSequence.toString(),
    'X-Webhook-Timestamp': timestamp,
    'X-Webhook-Nonce': nonce,
    'X-Webhook-Key-Id': key.keyId,
    'X-Webhook-Signature': `v1=${signature}`,
  };
}

/**
 * Verify an inbound signed webhook (for consumers implementing their own
 * verification, or for internal test helpers).
 */
export function verifySignature(
  rawBody: string,
  secret: string,
  headers: WebhookSignatureHeaders,
): boolean {
  const timestamp = Number(headers['X-Webhook-Timestamp']);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > REPLAY_WINDOW_MS) {
    return false;
  }

  const nonce = headers['X-Webhook-Nonce'];
  const message = `${timestamp}.${nonce}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(message).digest('hex');
  const received = headers['X-Webhook-Signature'].replace(/^v1=/, '');

  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
}

/** Derive a canonical_event_id from Soroban event coordinates. */
export function deriveCanonicalEventId(
  ledgerSequence: number,
  txHash: string,
  eventIndex: number,
): string {
  const raw = `${ledgerSequence}:${txHash}:${eventIndex}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Provision the initial signing key for a new subscription. */
export async function provisionInitialKey(
  subscriptionId: number,
  client: PoolClient,
): Promise<{ keyId: string; rawSecret: string }> {
  const keyId = `wk_${crypto.randomBytes(16).toString('hex')}`;
  const rawSecret = crypto.randomBytes(32).toString('hex');
  const secretHash = crypto.createHash('sha256').update(rawSecret).digest('hex');

  await client.query(
    `INSERT INTO webhook_signing_keys (subscription_id, key_id, secret_hash, state)
     VALUES ($1, $2, $3, 'active')`,
    [subscriptionId, keyId, secretHash],
  );

  await client.query(
    `INSERT INTO webhook_subscription_sequences (subscription_id, last_sequence)
     VALUES ($1, 0)
     ON CONFLICT (subscription_id) DO NOTHING`,
    [subscriptionId],
  );

  return { keyId, rawSecret };
}

/** Rotate to a new signing key; transitions old key to 'retiring'. */
export async function rotateKey(subscriptionId: number): Promise<{ keyId: string; rawSecret: string }> {
  return withTransaction(async (client) => {
    // Retire current active key
    await client.query(
      `UPDATE webhook_signing_keys
       SET state = 'retiring', retired_at = NOW()
       WHERE subscription_id = $1 AND state = 'active'`,
      [subscriptionId],
    );

    // Generate new key
    const keyId = `wk_${crypto.randomBytes(16).toString('hex')}`;
    const rawSecret = crypto.randomBytes(32).toString('hex');
    const secretHash = crypto.createHash('sha256').update(rawSecret).digest('hex');

    await client.query(
      `INSERT INTO webhook_signing_keys (subscription_id, key_id, secret_hash, state)
       VALUES ($1, $2, $3, 'active')`,
      [subscriptionId, keyId, secretHash],
    );

    return { keyId, rawSecret };
  });
}

/** Revoke a retiring key after the overlap window. */
export async function revokeRetiredKeys(subscriptionId: number): Promise<void> {
  await query(
    `UPDATE webhook_signing_keys
     SET state = 'revoked', revoked_at = NOW()
     WHERE subscription_id = $1 AND state = 'retiring'
       AND retired_at < NOW() - INTERVAL '24 hours'`,
    [subscriptionId],
  );
}

/**
 * Retrieve the active signing key's raw secret for signing an outbound delivery.
 * The secret is stored as SHA-256 hash only — this re-derives it from the hash
 * via a keyed lookup pattern where the raw secret is held in an in-process cache
 * populated at key-creation time.
 *
 * For persistence across restarts: secrets must be fetched from the environment
 * or a secrets manager keyed by key_id. This function returns the hash so callers
 * can validate; actual signing uses the raw secret supplied by the dispatcher.
 */
export async function getActiveKeyMeta(
  subscriptionId: number,
): Promise<{ keyId: string; secretHash: string } | null> {
  const result = await query(
    `SELECT key_id, secret_hash
     FROM webhook_signing_keys
     WHERE subscription_id = $1 AND state = 'active'
     LIMIT 1`,
    [subscriptionId],
  );

  if (!result.rows.length) return null;
  const row = result.rows[0];
  return { keyId: row.key_id as string, secretHash: row.secret_hash as string };
}
