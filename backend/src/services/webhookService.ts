import * as crypto from "crypto";
import { query } from "../db/connection.js";
import logger from "../utils/logger.js";

export const SUPPORTED_WEBHOOK_EVENT_TYPES = [
  "LoanRequested",
  "LoanApproved",
  "LoanRepaid",
  "LoanDefaulted",
  "Seized",
  "Paused",
  "Unpaused",
  "MinScoreUpdated",
] as const;

export type WebhookEventType = (typeof SUPPORTED_WEBHOOK_EVENT_TYPES)[number];

export interface IndexedLoanEvent {
  eventId: string;
  eventType: WebhookEventType;
  loanId?: number;
  borrower: string;
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
  maxAttempts: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookDelivery {
  id: number;
  subscriptionId: number;
  eventId: string;
  eventType: WebhookEventType;
  payload: Record<string, unknown>;
  attemptCount: number;
  lastStatusCode?: number;
  lastError?: string;
  nextRetryAt?: Date;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface RegisterWebhookInput {
  callbackUrl: string;
  eventTypes: WebhookEventType[];
  secret?: string | undefined;
  maxAttempts?: number | undefined;
}

export class WebhookService {
  static isSupported(type: string): type is WebhookEventType {
    return SUPPORTED_WEBHOOK_EVENT_TYPES.includes(type as WebhookEventType);
  }

  async registerSubscription(
    input: RegisterWebhookInput,
  ): Promise<WebhookSubscription> {
    const result = await query(
      `INSERT INTO webhook_subscriptions (callback_url, event_types, secret, max_attempts, is_active)
       VALUES ($1, $2::jsonb, $3, $4, true)
       RETURNING id, callback_url, event_types, secret, max_attempts, is_active, created_at, updated_at`,
      [
        input.callbackUrl,
        JSON.stringify(input.eventTypes),
        input.secret ?? null,
        input.maxAttempts ?? 5,
      ],
    );

    return this.mapSubscriptionRow(result.rows[0] as Record<string, unknown>);
  }

  async listSubscriptions(): Promise<WebhookSubscription[]> {
    const result = await query(
      `SELECT id, callback_url, event_types, secret, max_attempts, is_active, created_at, updated_at
       FROM webhook_subscriptions
       ORDER BY created_at DESC`,
      [],
    );

    return result.rows.map((row: any) =>
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
      `SELECT id, subscription_id, event_id, event_type, payload, attempt_count,
              last_status_code, last_error, next_retry_at, delivered_at, created_at, updated_at
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
      borrower: event.borrower,
    });

    try {
      const webhooksResult = await query(
        `SELECT id, callback_url, secret, max_attempts
         FROM webhook_subscriptions
         WHERE is_active = true
           AND event_types @> $1::jsonb`,
        [JSON.stringify([event.eventType])],
      );

      await Promise.all(
        webhooksResult.rows.map((hook: any) =>
          this.sendToWebhook(
            Number((hook as { id: number }).id),
            String((hook as { callback_url: string }).callback_url),
            ((hook as { secret?: string | null }).secret ?? undefined) ||
              undefined,
            Number((hook as { max_attempts: number }).max_attempts),
            event as unknown as Record<string, unknown>,
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

  async sendToWebhook(
    subscriptionId: number,
    callbackUrl: string,
    secret: string | undefined,
    maxAttempts: number,
    payload: Record<string, unknown>,
    deliveryId?: number,
    currentAttempt: number = 1,
  ): Promise<void> {
    const body = JSON.stringify(payload);

    const signature = secret
      ? crypto.createHmac("sha256", secret).update(body).digest("hex")
      : undefined;

    let successful = false;
    let statusCode: number | null = null;
    let errorMsg: string | null = null;

    try {
      const response = await fetch(callbackUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(signature && { "x-remitlend-signature": signature }),
        },
        body,
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      successful = response.ok;
      statusCode = response.status;
      if (!successful) {
        errorMsg = `Webhook returned status ${response.status}`;
      }
    } catch (error) {
      errorMsg =
        error instanceof Error ? error.message : "Unknown webhook error";
      logger.error("Fetch error during webhook delivery", {
        subscriptionId,
        callbackUrl,
        error,
      });
    }

    const nextRetryAt =
      !successful && currentAttempt < maxAttempts
        ? this.calculateNextRetry(currentAttempt)
        : null;

    if (deliveryId) {
      // Update existing delivery (retry)
      await query(
        `UPDATE webhook_deliveries
         SET attempt_count = $1,
             last_status_code = $2,
             last_error = $3,
             delivered_at = $4,
             next_retry_at = $5,
             updated_at = current_timestamp
         WHERE id = $6`,
        [
          currentAttempt,
          statusCode,
          errorMsg,
          successful ? new Date() : null,
          nextRetryAt,
          deliveryId,
        ],
      );
    } else {
      // Create new delivery record (initial attempt)
      await query(
        `INSERT INTO webhook_deliveries (
          subscription_id,
          event_id,
          event_type,
          payload,
          attempt_count,
          last_status_code,
          last_error,
          delivered_at,
          next_retry_at
        )
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)`,
        [
          subscriptionId,
          String(payload.eventId),
          String(payload.eventType),
          JSON.stringify(payload),
          currentAttempt,
          statusCode,
          errorMsg,
          successful ? new Date() : null,
          nextRetryAt,
        ],
      );
    }

    if (!successful) {
      logger.warn("Webhook delivery failed", {
        subscriptionId,
        callbackUrl,
        eventId: payload.eventId,
        attempt: currentAttempt,
        nextRetryAt,
      });
    } else {
      logger.info("Webhook delivery successful", {
        subscriptionId,
        eventId: payload.eventId,
      });
    }
  }

  private calculateNextRetry(attemptCount: number): Date {
    // Exponential backoff: 2^attemptCount minutes (1: 2m, 2: 4m, 3: 8m, 4: 16m)
    // Or simpler: 1m, 5m, 15m, 30m, 1h
    const minutes = [1, 5, 15, 30, 60, 120, 240, 480];
    const backoffMinutes = minutes[attemptCount - 1] ?? (attemptCount - 1) * 60;
    const delayMs = backoffMinutes * 60 * 1000;
    return new Date(Date.now() + delayMs);
  }

  async getPendingRetries(limit: number = 50): Promise<WebhookDelivery[]> {
    const result = await query(
      `SELECT d.id, d.subscription_id, d.event_id, d.event_type, d.payload, d.attempt_count,
              d.last_status_code, d.last_error, d.next_retry_at, d.delivered_at,
              d.created_at, d.updated_at, s.callback_url, s.secret, s.max_attempts
       FROM webhook_deliveries d
       JOIN webhook_subscriptions s ON d.subscription_id = s.id
       WHERE d.delivered_at IS NULL
         AND d.next_retry_at <= current_timestamp
         AND d.attempt_count < s.max_attempts
         AND s.is_active = true
       ORDER BY d.next_retry_at ASC
       LIMIT $1`,
      [limit],
    );

    return result.rows.map((row) =>
      this.mapDeliveryRow(row as Record<string, unknown>),
    );
  }

  async mapRetryToContext(row: any) {
    return {
      id: Number(row.id),
      subscriptionId: Number(row.subscription_id),
      callbackUrl: String(row.callback_url),
      secret: (String(row.secret) || undefined) as string | undefined,
      maxAttempts: Number(row.max_attempts),
      payload: row.payload as Record<string, unknown>,
      attemptCount: Number(row.attempt_count),
    };
  }

  private mapSubscriptionRow(row: Record<string, unknown>): WebhookSubscription {
    const secret =
      typeof row.secret === "string" && row.secret.length > 0
        ? row.secret
        : undefined;

    return {
      id: Number(row.id),
      callbackUrl: String(row.callback_url),
      eventTypes: (row.event_types as WebhookEventType[]) ?? [],
      ...(secret ? { secret } : {}),
      maxAttempts: Number(row.max_attempts ?? 5),
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
      payload: (row.payload as Record<string, unknown>) ?? {},
      attemptCount: Number(row.attempt_count ?? 1),
      ...(lastStatusCode !== undefined ? { lastStatusCode } : {}),
      ...(lastError ? { lastError } : {}),
      ...(row.next_retry_at ? { nextRetryAt: new Date(String(row.next_retry_at)) } : {}),
      ...(deliveredAt ? { deliveredAt } : {}),
      createdAt: new Date(String(row.created_at)),
      updatedAt: new Date(String(row.updated_at)),
    };
  }
}

export const webhookService = new WebhookService();
