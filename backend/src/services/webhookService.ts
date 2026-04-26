import crypto from "node:crypto";
import { query } from "../db/connection.js";
import logger from "../utils/logger.js";

export const SUPPORTED_WEBHOOK_EVENT_TYPES = [
  "LoanRequested",
  "LoanApproved",
  "LoanRepaid",
  "LoanDefaulted",
  "CollateralLiquidated",
  "ColDep",
  "ColRel",
  "LateFeeCharged",
  "LoanExtended",
  "LoanCancelled",
  "LoanRejected",
  "LoanRefinanced",
  "LateFeeRateUpdated",
  "Deposit",
  "Withdraw",
  "YieldDistributed",
  "EmergencyWithdraw",
  "DepositCapUpdated",
  "WithdrawalCooldownUpdated",
  "Mint",
  "ScoreUpd",
  "ScoreDecr",
  "Seized",
  "NftBurned",
  "AdmRemint",
  "HashUpd",
  "Transfer",
  "MntAuth",
  "MntRev",
  "Paused",
  "Unpaused",
  "MinScoreUpdated",
  "PoolPaused",
  "PoolUnpaused",
  "GovProp",
  "GovAppr",
  "GovFin",
  "GovCncl",
  "GovEmerg",
  "GovExp",
] as const;

export type WebhookEventType = (typeof SUPPORTED_WEBHOOK_EVENT_TYPES)[number];

export interface IndexedLoanEvent {
  eventId: string;
  eventType: WebhookEventType;
  loanId?: number;
  address?: string;
  amount?: string;
  interestRateBps?: number;
  termLedgers?: number;
  ledger: number;
  ledgerClosedAt: Date;
  txHash: string;
  contractId: string;
  topics: string[];
  value: string;
}

export interface WebhookSubscription {
  id: number;
  callbackUrl: string;
  eventTypes: WebhookEventType[];
  secret?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookDelivery {
  id: number;
  subscriptionId: number;
  eventId: string;
  eventType: WebhookEventType;
  attemptCount: number;
  lastStatusCode?: number;
  lastError?: string;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface RegisterWebhookInput {
  callbackUrl: string;
  eventTypes: WebhookEventType[];
  secret?: string;
}

interface PreparedWebhookPayload {
  body: string;
  payload: Record<string, unknown>;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getWebhookRequestTimeoutMs(): number {
  return parsePositiveInt(process.env.WEBHOOK_REQUEST_TIMEOUT_MS, 30 * 1000);
}

function getWebhookMaxPayloadBytes(): number {
  return parsePositiveInt(process.env.WEBHOOK_MAX_PAYLOAD_BYTES, 64 * 1024);
}

function summarizeOversizedPayload(
  payload: Record<string, unknown>,
  originalPayloadBytes: number,
  maxPayloadBytes: number,
): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    truncated: true,
    reason: "payload_too_large",
    originalPayloadBytes,
    maxPayloadBytes,
  };

  const passthroughKeys = [
    "eventId",
    "eventType",
    "loanId",
    "address",
    "ledger",
  ] as const;

  for (const key of passthroughKeys) {
    const value = payload[key];
    if (value !== undefined) {
      summary[key] = value;
    }
  }

  if (Array.isArray(payload.topics)) {
    summary.topicsCount = payload.topics.length;
  }

  return summary;
}

function summarizeOversizedPayloadMinimal(
  payload: Record<string, unknown>,
  originalPayloadBytes: number,
  maxPayloadBytes: number,
): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    truncated: true,
    reason: "payload_too_large",
    originalPayloadBytes,
    maxPayloadBytes,
  };

  if (typeof payload.eventId === "string") {
    summary.eventId = payload.eventId;
  }
  if (typeof payload.eventType === "string") {
    summary.eventType = payload.eventType;
  }

  return summary;
}

function prepareWebhookPayload(
  payload: Record<string, unknown>,
): PreparedWebhookPayload {
  const body = JSON.stringify(payload);
  const payloadBytes = Buffer.byteLength(body);
  const maxPayloadBytes = getWebhookMaxPayloadBytes();
  const eventId =
    typeof payload.eventId === "string" ? payload.eventId : undefined;
  const eventType =
    typeof payload.eventType === "string" ? payload.eventType : undefined;

  if (payloadBytes > maxPayloadBytes) {
    let summarizedPayload = summarizeOversizedPayload(
      payload,
      payloadBytes,
      maxPayloadBytes,
    );
    let summarizedBody = JSON.stringify(summarizedPayload);

    if (Buffer.byteLength(summarizedBody) > maxPayloadBytes) {
      summarizedPayload = summarizeOversizedPayloadMinimal(
        payload,
        payloadBytes,
        maxPayloadBytes,
      );
      summarizedBody = JSON.stringify(summarizedPayload);
    }

    if (Buffer.byteLength(summarizedBody) > maxPayloadBytes) {
      throw new Error(
        `Webhook summary payload exceeds configured limit of ${maxPayloadBytes} bytes`,
      );
    }

    logger.warn("Webhook payload exceeds size limit, sending summary payload", {
      eventId,
      eventType,
      payloadBytes,
      maxPayloadBytes,
    });

    return {
      body: summarizedBody,
      payload: summarizedPayload,
    };
  }

  if (payloadBytes >= Math.floor(maxPayloadBytes * 0.9)) {
    logger.warn("Webhook payload is near size limit", {
      eventId,
      eventType,
      payloadBytes,
      maxPayloadBytes,
    });
  }

  return {
    body,
    payload,
  };
}

async function postWebhook(
  callbackUrl: string,
  body: string,
  signature: string | undefined,
): Promise<Response> {
  const timeoutMs = getWebhookRequestTimeoutMs();
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  timeoutHandle.unref?.();

  try {
    return await fetch(callbackUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(signature && { "x-remitlend-signature": signature }),
      },
      body,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Webhook request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

// Retry configuration for webhook delivery.
// This yields retry attempts at ~5m, ~15m, and ~45m after a failed delivery,
// for a total retry window a little over one hour after the initial attempt.
const RETRY_DELAYS_MS = [
  5 * 60 * 1000,
  15 * 60 * 1000,
  45 * 60 * 1000,
] as const;

const MAX_RETRY_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

export const getRetryDelayMs = (attemptNumber: number): number => {
  const delayIndex = Math.min(attemptNumber - 1, RETRY_DELAYS_MS.length - 1);
  return (
    RETRY_DELAYS_MS[delayIndex] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!
  );
};

export class WebhookService {
  // Retry processor that polls for pending retries
  static async processRetries(): Promise<void> {
    logger.info("Starting webhook retry processor");

    try {
      const now = new Date();
      const result = await query(
        `SELECT id, subscription_id, callback_url, secret, event_id, event_type, 
                payload, attempt_count
         FROM webhook_deliveries wd
         JOIN webhook_subscriptions ws ON wd.subscription_id = ws.id
         WHERE wd.delivered_at IS NULL 
           AND wd.next_retry_at IS NOT NULL
           AND wd.next_retry_at <= $1
           AND wd.attempt_count < $2
         ORDER BY wd.next_retry_at ASC
         LIMIT 100`,
        [now, MAX_RETRY_ATTEMPTS],
      );

      if (result.rows.length === 0) {
        logger.debug("No pending webhook retries");
        return;
      }

      logger.info(`Processing ${result.rows.length} pending webhook retries`);

      for (const row of result.rows) {
        const delivery = row as unknown as {
          id: number;
          subscription_id: number;
          callback_url: string;
          secret: string | null;
          event_id: string;
          event_type: string;
          payload: Record<string, unknown>;
          attempt_count: number;
        };
        await WebhookService.retryWebhookDelivery(
          delivery.id,
          delivery.subscription_id,
          delivery.callback_url,
          delivery.secret || undefined,
          delivery.event_id,
          delivery.event_type as WebhookEventType,
          delivery.payload,
          delivery.attempt_count,
        );
      }
    } catch (error) {
      logger.error("Error in webhook retry processor", { error });
    }
  }

  public static async retryWebhookDelivery(
    deliveryId: number,
    subscriptionId: number,
    callbackUrl: string,
    secret: string | undefined,
    eventId: string,
    eventType: WebhookEventType,
    payload: Record<string, unknown>,
    attemptCount: number,
  ): Promise<void> {
    const preparedPayload = prepareWebhookPayload(payload);
    const body = preparedPayload.body;

    const signature = secret
      ? crypto.createHmac("sha256", secret).update(body).digest("hex")
      : undefined;

    let response: Response | null = null;

    try {
      response = await postWebhook(callbackUrl, body, signature);

      const successful = response.ok;
      const newAttemptCount = attemptCount + 1;

      if (successful) {
        // Mark as delivered
        await query(
          `UPDATE webhook_deliveries 
           SET attempt_count = $1, 
               last_status_code = $2, 
               delivered_at = $3,
               last_error = NULL,
               next_retry_at = NULL,
               updated_at = $4
           WHERE id = $5`,
          [
            newAttemptCount,
            response.status,
            new Date(),
            new Date(),
            deliveryId,
          ],
        );

        logger.info("Webhook delivery succeeded after retry", {
          deliveryId,
          subscriptionId,
          eventId,
          attemptCount: newAttemptCount,
        });
      } else {
        // Schedule next retry or mark as permanently failed
        const nextRetryTime =
          newAttemptCount < MAX_RETRY_ATTEMPTS
            ? new Date(Date.now() + getRetryDelayMs(newAttemptCount))
            : null;

        const errorMsg = `Webhook returned status ${response.status}`;
        await query(
          `UPDATE webhook_deliveries 
           SET attempt_count = $1, 
               last_status_code = $2, 
               last_error = $3,
               next_retry_at = $4,
               updated_at = $5
           WHERE id = $6`,
          [
            newAttemptCount,
            response.status,
            errorMsg,
            nextRetryTime,
            new Date(),
            deliveryId,
          ],
        );

        if (nextRetryTime) {
          logger.warn("Webhook delivery failed, scheduled retry", {
            deliveryId,
            subscriptionId,
            eventId,
            attemptCount: newAttemptCount,
            statusCode: response.status,
            nextRetryAt: nextRetryTime,
          });
        } else {
          logger.error(
            "Webhook delivery permanently failed after max retries",
            {
              deliveryId,
              subscriptionId,
              eventId,
              attemptCount: newAttemptCount,
              statusCode: response.status,
              payload: body,
            },
          );
        }
      }
    } catch (error) {
      const newAttemptCount = attemptCount + 1;
      const nextRetryTime =
        newAttemptCount < MAX_RETRY_ATTEMPTS
          ? new Date(Date.now() + getRetryDelayMs(newAttemptCount))
          : null;

      const errorMsg =
        error instanceof Error ? error.message : "Unknown webhook error";

      await query(
        `UPDATE webhook_deliveries 
         SET attempt_count = $1, 
             last_error = $2,
             next_retry_at = $3,
             updated_at = $4
         WHERE id = $5`,
        [newAttemptCount, errorMsg, nextRetryTime, new Date(), deliveryId],
      );

      if (nextRetryTime) {
        logger.warn("Webhook delivery error, scheduled retry", {
          deliveryId,
          subscriptionId,
          eventId,
          attemptCount: newAttemptCount,
          error,
          nextRetryAt: nextRetryTime,
        });
      } else {
        logger.error("Webhook delivery permanently failed after max retries", {
          deliveryId,
          subscriptionId,
          eventId,
          attemptCount: newAttemptCount,
          error,
        });
      }
    }
  }
  static isSupported(type: string): type is WebhookEventType {
    return SUPPORTED_WEBHOOK_EVENT_TYPES.includes(type as WebhookEventType);
  }

  async registerSubscription(
    input: RegisterWebhookInput,
  ): Promise<WebhookSubscription> {
    const result = await query(
      `INSERT INTO webhook_subscriptions (callback_url, event_types, secret, is_active)
       VALUES ($1, $2::jsonb, $3, true)
       RETURNING id, callback_url, event_types, secret, is_active, created_at, updated_at`,
      [
        input.callbackUrl,
        JSON.stringify(input.eventTypes),
        input.secret ?? null,
      ],
    );

    return this.mapSubscriptionRow(result.rows[0] as Record<string, unknown>);
  }

  async listSubscriptions(): Promise<WebhookSubscription[]> {
    const result = await query(
      `SELECT id, callback_url, event_types, secret, is_active, created_at, updated_at
       FROM webhook_subscriptions
       ORDER BY created_at DESC`,
      [],
    );

    return result.rows.map((row) =>
      this.mapSubscriptionRow(row as Record<string, unknown>),
    );
  }

  async deleteSubscription(id: number): Promise<boolean> {
    const result = await query(
      `DELETE FROM webhook_subscriptions
       WHERE id = $1`,
      [id],
    );

    return (result.rowCount ?? 0) > 0;
  }

  async getSubscriptionDeliveries(
    subscriptionId: number,
    limit: number = 50,
  ): Promise<WebhookDelivery[]> {
    const result = await query(
      `SELECT id, subscription_id, event_id, event_type, attempt_count, last_status_code,
              last_error, delivered_at, created_at, updated_at
       FROM webhook_deliveries
       WHERE subscription_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [subscriptionId, limit],
    );

    return result.rows.map((row) =>
      this.mapDeliveryRow(row as Record<string, unknown>),
    );
  }

  async dispatch(event: IndexedLoanEvent): Promise<void> {
    logger.info("Dispatching webhook event", {
      eventId: event.eventId,
      eventType: event.eventType,
      loanId: event.loanId,
      address: event.address,
    });

    try {
      const preparedPayload = prepareWebhookPayload(
        event as unknown as Record<string, unknown>,
      );
      const webhooksResult = await query(
        `SELECT id, callback_url, secret
         FROM webhook_subscriptions
         WHERE is_active = true
           AND event_types @> $1::jsonb`,
        [JSON.stringify([event.eventType])],
      );

      await Promise.all(
        webhooksResult.rows.map((hook) =>
          this.sendToWebhook(
            Number((hook as { id: number }).id),
            String((hook as { callback_url: string }).callback_url),
            ((hook as { secret?: string | null }).secret ?? undefined) ||
              undefined,
            preparedPayload,
          ),
        ),
      );
    } catch (error) {
      logger.error("Error during webhook dispatch", {
        eventId: event.eventId,
        eventType: event.eventType,
        error,
      });
    }
  }

  private async sendToWebhook(
    subscriptionId: number,
    callbackUrl: string,
    secret: string | undefined,
    payload: PreparedWebhookPayload,
  ): Promise<void> {
    const body = payload.body;

    const signature = secret
      ? crypto.createHmac("sha256", secret).update(body).digest("hex")
      : undefined;

    try {
      const response = await postWebhook(callbackUrl, body, signature);

      const successful = response.ok;

      if (successful) {
        // Delivery succeeded, mark as delivered
        await query(
          `INSERT INTO webhook_deliveries (
            subscription_id,
            event_id,
            event_type,
            attempt_count,
            last_status_code,
            delivered_at,
            payload,
            next_retry_at
          )
          VALUES ($1, $2, $3, 1, $4, $5, $6::jsonb, NULL)`,
          [
            subscriptionId,
            payload.payload.eventId,
            payload.payload.eventType,
            response.status,
            new Date(),
            body,
          ],
        );
      } else {
        // Delivery failed, schedule first retry
        const nextRetryAt = new Date(Date.now() + getRetryDelayMs(1));
        await query(
          `INSERT INTO webhook_deliveries (
            subscription_id,
            event_id,
            event_type,
            attempt_count,
            last_status_code,
            last_error,
            payload,
            next_retry_at
          )
          VALUES ($1, $2, $3, 1, $4, $5, $6::jsonb, $7)`,
          [
            subscriptionId,
            payload.payload.eventId,
            payload.payload.eventType,
            response.status,
            `Webhook returned status ${response.status}`,
            body,
            nextRetryAt,
          ],
        );

        logger.warn("Webhook delivery failed, scheduled retry", {
          subscriptionId,
          callbackUrl,
          eventId: payload.payload.eventId,
          statusCode: response.status,
          nextRetryAt,
        });
      }
    } catch (error) {
      // Network error or timeout, schedule first retry
      const nextRetryAt = new Date(Date.now() + getRetryDelayMs(1));
      await query(
        `INSERT INTO webhook_deliveries (
          subscription_id,
          event_id,
          event_type,
          attempt_count,
          last_error,
          payload,
          next_retry_at
        )
        VALUES ($1, $2, $3, 1, $4, $5::jsonb, $6)`,
        [
          subscriptionId,
          payload.payload.eventId,
          payload.payload.eventType,
          error instanceof Error ? error.message : "Unknown webhook error",
          body,
          nextRetryAt,
        ],
      );

      logger.error("Failed to send webhook, scheduled retry", {
        subscriptionId,
        callbackUrl,
        eventId: payload.payload.eventId,
        error,
        nextRetryAt,
      });
    }
  }

  private mapSubscriptionRow(
    row: Record<string, unknown>,
  ): WebhookSubscription {
    const secret =
      typeof row.secret === "string" && row.secret.length > 0
        ? row.secret
        : undefined;

    return {
      id: Number(row.id),
      callbackUrl: String(row.callback_url),
      eventTypes: (row.event_types as WebhookEventType[]) ?? [],
      ...(secret ? { secret } : {}),
      isActive: Boolean(row.is_active),
      createdAt: new Date(String(row.created_at)),
      updatedAt: new Date(String(row.updated_at)),
    };
  }

  private mapDeliveryRow(row: Record<string, unknown>): WebhookDelivery {
    const lastStatusCode =
      typeof row.last_status_code === "number"
        ? row.last_status_code
        : row.last_status_code !== null && row.last_status_code !== undefined
          ? Number(row.last_status_code)
          : undefined;

    const lastError =
      typeof row.last_error === "string" && row.last_error.length > 0
        ? row.last_error
        : undefined;

    const deliveredAt = row.delivered_at
      ? new Date(String(row.delivered_at))
      : undefined;

    return {
      id: Number(row.id),
      subscriptionId: Number(row.subscription_id),
      eventId: String(row.event_id),
      eventType: String(row.event_type) as WebhookEventType,
      attemptCount: Number(row.attempt_count ?? 1),
      ...(lastStatusCode !== undefined ? { lastStatusCode } : {}),
      ...(lastError ? { lastError } : {}),
      ...(deliveredAt ? { deliveredAt } : {}),
      createdAt: new Date(String(row.created_at)),
      updatedAt: new Date(String(row.updated_at)),
    };
  }
}

export const webhookService = new WebhookService();
