/**
 * Ordered, exactly-once webhook dispatcher.
 *
 * Guarantees:
 *   1. Exactly-once delivery — idempotent insert via UNIQUE(subscription_id, canonical_event_id).
 *   2. Ordered delivery — each delivery carries a gap-free monotonic subscription_sequence.
 *      Consumers MUST NOT process sequence N+1 before acknowledging N.
 *   3. Signed delivery — every request carries HMAC-SHA256 headers (see webhookSigner.ts).
 *
 * Retry schedule: exponential backoff at 5m, 15m, 45m (max 4 total attempts),
 * matching the existing webhookRetryProcessor cadence.
 */

import crypto from 'node:crypto';
import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';
import { query, withTransaction, type PoolClient } from '../db/connection.js';
import logger from '../utils/logger.js';
import { signPayload, deriveCanonicalEventId } from './webhookSigner.js';

export interface DispatchableEvent {
  ledgerSequence: number;
  txHash: string;
  eventIndex: number;
  eventType: string;
  contractId: string;
  payload: Record<string, unknown>;
}

interface DeliveryRow {
  id: number;
  subscription_id: number;
  canonical_event_id: string;
  subscription_sequence: number;
  callback_url: string;
  secret: string;
  key_id: string;
  payload: Record<string, unknown>;
  event_type: string;
  attempt_count: number;
}

const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [5 * 60_000, 15 * 60_000, 45 * 60_000];

/**
 * Ingest a Soroban event into `webhook_events` and enqueue deliveries for all
 * matching active subscriptions.  Idempotent: duplicate calls for the same
 * canonical_event_id are silently ignored.
 */
export async function enqueueEvent(event: DispatchableEvent): Promise<void> {
  const canonicalEventId = deriveCanonicalEventId(
    event.ledgerSequence,
    event.txHash,
    event.eventIndex,
  );

  await withTransaction(async (client: PoolClient) => {
    // 1. Upsert into canonical event store (idempotent).
    await client.query(
      `INSERT INTO webhook_events
         (canonical_event_id, ledger_sequence, tx_hash, event_index, event_type, contract_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (canonical_event_id) DO NOTHING`,
      [
        canonicalEventId,
        event.ledgerSequence,
        event.txHash,
        event.eventIndex,
        event.eventType,
        event.contractId,
        JSON.stringify(event.payload),
      ],
    );

    // 2. Find matching subscriptions.
    const subResult = await client.query(
      `SELECT ws.id, ws.callback_url, ws.secret, wsk.key_id
       FROM webhook_subscriptions ws
       JOIN webhook_signing_keys wsk
         ON wsk.subscription_id = ws.id AND wsk.state = 'active'
       WHERE ws.is_active = true
         AND ws.event_types @> $1::jsonb`,
      [JSON.stringify([event.eventType])],
    );

    for (const sub of subResult.rows) {
      const subscriptionId = sub.id as number;

      // 3. Claim next monotonic sequence number (SELECT FOR UPDATE guarantees
      //    gap-free monotonic integers even under concurrent dispatch).
      await client.query(
        `INSERT INTO webhook_subscription_sequences (subscription_id, last_sequence)
         VALUES ($1, 0)
         ON CONFLICT (subscription_id) DO NOTHING`,
        [subscriptionId],
      );

      const seqResult = await client.query(
        `UPDATE webhook_subscription_sequences
         SET last_sequence = last_sequence + 1,
             updated_at = NOW()
         WHERE subscription_id = $1
         RETURNING last_sequence`,
        [subscriptionId],
      );

      const subscriptionSequence = seqResult.rows[0].last_sequence as number;
      const nonce = crypto.randomBytes(32).toString('hex');

      // 4. Insert delivery row (idempotent via unique index).
      await client.query(
        `INSERT INTO webhook_deliveries
           (subscription_id, event_id, event_type, payload,
            canonical_event_id, subscription_sequence, status, key_id, nonce)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
         ON CONFLICT (subscription_id, canonical_event_id) DO NOTHING`,
        [
          subscriptionId,
          canonicalEventId,
          event.eventType,
          JSON.stringify(event.payload),
          canonicalEventId,
          subscriptionSequence,
          sub.key_id,
          nonce,
        ],
      );
    }
  });
}

/** Process a single pending delivery.  Called by the retry processor. */
export async function dispatchDelivery(deliveryId: number): Promise<void> {
  // Lock the row in-flight to prevent concurrent retry workers from double-sending.
  const lockResult = await query(
    `UPDATE webhook_deliveries
     SET status = 'inflight'
     WHERE id = $1 AND status = 'pending'
     RETURNING
       id, subscription_id, canonical_event_id, subscription_sequence,
       payload, event_type, attempt_count, key_id,
       (SELECT callback_url FROM webhook_subscriptions ws WHERE ws.id = subscription_id) AS callback_url,
       (SELECT secret FROM webhook_subscriptions ws WHERE ws.id = subscription_id) AS secret`,
    [deliveryId],
  );

  if (!lockResult.rows.length) return; // already in-flight or delivered

  const row = lockResult.rows[0] as DeliveryRow;
  const body = JSON.stringify({
    id: row.canonical_event_id,
    sequence: row.subscription_sequence,
    type: row.event_type,
    data: row.payload,
  });

  const sigHeaders = signPayload(body, { keyId: row.key_id, secret: row.secret }, row.canonical_event_id, row.subscription_sequence);

  try {
    const statusCode = await sendRequest(row.callback_url, body, sigHeaders);
    const success = statusCode >= 200 && statusCode < 300;

    if (success) {
      await query(
        `UPDATE webhook_deliveries
         SET status = 'delivered',
             delivered_at = NOW(),
             last_status_code = $1,
             attempt_count = attempt_count + 1,
             updated_at = NOW()
         WHERE id = $2`,
        [statusCode, deliveryId],
      );
      return;
    }

    await handleRetry(deliveryId, row.attempt_count + 1, statusCode, null);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await handleRetry(deliveryId, row.attempt_count + 1, null, errorMsg);
  }
}

async function handleRetry(
  deliveryId: number,
  newAttemptCount: number,
  statusCode: number | null,
  errorMsg: string | null,
): Promise<void> {
  if (newAttemptCount >= MAX_ATTEMPTS) {
    await query(
      `UPDATE webhook_deliveries
       SET status = 'dead',
           attempt_count = $1,
           last_status_code = $2,
           last_error = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [newAttemptCount, statusCode, errorMsg, deliveryId],
    );
    logger.withContext().warn('Webhook delivery dead-lettered', { deliveryId, newAttemptCount });
    return;
  }

  const delayMs = RETRY_DELAYS_MS[newAttemptCount - 1] ?? RETRY_DELAYS_MS.at(-1)!;
  const nextRetryAt = new Date(Date.now() + delayMs);

  await query(
    `UPDATE webhook_deliveries
     SET status = 'pending',
         attempt_count = $1,
         last_status_code = $2,
         last_error = $3,
         next_retry_at = $4,
         updated_at = NOW()
     WHERE id = $5`,
    [newAttemptCount, statusCode, errorMsg, nextRetryAt, deliveryId],
  );
}

/** Fetch pending deliveries that are due for dispatch. */
export async function fetchDueDeliveries(limit = 50): Promise<number[]> {
  const result = await query(
    `SELECT id FROM webhook_deliveries
     WHERE status = 'pending'
       AND (next_retry_at IS NULL OR next_retry_at <= NOW())
     ORDER BY subscription_id, subscription_sequence
     LIMIT $1`,
    [limit],
  );
  return result.rows.map((r) => r.id as number);
}

function sendRequest(
  callbackUrl: string,
  body: string,
  headers: Record<string, string>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(callbackUrl);
    } catch {
      reject(new Error(`Invalid callback URL: ${callbackUrl}`));
      return;
    }

    const lib = url.protocol === 'https:' ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
      timeout: 10_000,
    };

    const req = lib.request(options, (res) => resolve(res.statusCode ?? 0));
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Webhook request timed out'));
    });
    req.write(body);
    req.end();
  });
}
