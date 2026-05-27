import { query } from "../db/connection.js";
import logger from "../utils/logger.js";
import type { Response } from "express";
import twilio from "twilio";
import sgMail from "@sendgrid/mail";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationType =
  | "loan_approved"
  | "repayment_due"
  | "repayment_confirmed"
  | "loan_defaulted"
  | "score_changed";

export type NotificationStatus = "unread" | "read" | "archived";

export interface Notification {
  id: number;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  loanId?: number | undefined;
  read: boolean;
  status: NotificationStatus;
  createdAt: Date;
}

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  loanId?: number | undefined;
}

// ─── SSE subscriber registry ──────────────────────────────────────────────────
// Maps userId → set of SSE response streams currently listening.
// No persistence needed — streams are in-process only.

type SseClient = Response;
const sseClients = new Map<string, Set<SseClient>>();

// Initialize Twilio client if credentials are provided
const twilioClient =
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_AUTH_TOKEN &&
  process.env.TWILIO_PHONE_NUMBER
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

// Configure SendGrid if API key is present
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

function buildEmailTemplate(
  type: NotificationType,
  message: string,
): { subject: string; html: string } {
  const templates: Record<NotificationType, { subject: string; html: string }> =
    {
      loan_approved: {
        subject: "Your loan has been approved — RemitLend",
        html: `<h2>Loan Approved</h2><p>${message}</p><p>Log in to view your loan details and repayment schedule.</p>`,
      },
      repayment_due: {
        subject: "Repayment reminder — RemitLend",
        html: `<h2>Repayment Due Soon</h2><p>${message}</p><p>Please ensure funds are available to avoid a default.</p>`,
      },
      repayment_confirmed: {
        subject: "Repayment confirmed — RemitLend",
        html: `<h2>Repayment Confirmed</h2><p>${message}</p><p>Thank you for your payment.</p>`,
      },
      loan_defaulted: {
        subject: "Loan default notice — RemitLend",
        html: `<h2>Loan Defaulted</h2><p>${message}</p><p>Contact support immediately if you believe this is an error.</p>`,
      },
      score_changed: {
        subject: "Your credit score has changed — RemitLend",
        html: `<h2>Credit Score Update</h2><p>${message}</p><p>Log in to see your updated score and history.</p>`,
      },
    };

  return templates[type];
}

async function sendEmail(
  email: string,
  message: string,
  type?: NotificationType,
): Promise<void> {
  const fromEmail = process.env.FROM_EMAIL;

  if (!process.env.SENDGRID_API_KEY || !fromEmail) {
    logger.info(
      `[Email] SendGrid not configured. Would send to ${email}: ${message}`,
    );
    return;
  }

  const template = type
    ? buildEmailTemplate(type, message)
    : { subject: "Notification from RemitLend", html: `<p>${message}</p>` };

  try {
    await sgMail.send({
      to: email,
      from: fromEmail,
      subject: template.subject,
      html: template.html,
    });
    logger.info(`[Email] Sent to ${email}`, { subject: template.subject });
  } catch (error) {
    logger.error(`[Email] SendGrid failed for ${email}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    // Swallow error — email failure must not break the main flow
  }
}

async function sendSMS(phone: string, message: string) {
  if (!twilioClient || !process.env.TWILIO_PHONE_NUMBER) {
    logger.warn(
      `[SMS] Twilio not configured. Would send to ${phone}: ${message}`,
    );
    return;
  }

  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone,
    });
    logger.info(`[SMS] Sent to ${phone}: ${message}`, { sid: result.sid });
  } catch (error) {
    logger.error(`[SMS] Failed to send to ${phone}`, {
      error: error instanceof Error ? error.message : String(error),
      phone,
    });
    // Swallow error - don't fail the notification creation
  }
}

class NotificationService {
  /**
   * Persists a new notification and pushes it to any active SSE subscribers
   * for that user.
   */
  async createNotification(
    params: CreateNotificationParams,
  ): Promise<Notification> {
    const { userId, type, title, message, loanId } = params;

    const result = await query(
      `INSERT INTO notifications (user_id, type, title, message, loan_id, status)
       VALUES ($1, $2, $3, $4, $5, 'unread')
       RETURNING id, user_id, type, title, message, loan_id, read, status, created_at`,
      [userId, type, title, message, loanId ?? null],
    );

    const notification = this.mapRow(result.rows[0]);
    this.broadcast(userId, notification);

    // Also trigger external notifications
    await this.notifyUserExternal(userId, message, type);

    return notification;
  }

  /**
   * Sends external notifications (Email/SMS) based on user preferences.
   * SMS is triggered for repayment_due and loan_defaulted events.
   */
  private async notifyUserExternal(
    userId: string,
    message: string,
    type: NotificationType,
  ) {
    try {
      const result = await query(
        `SELECT email, phone, email_enabled, sms_enabled 
         FROM user_profiles 
         WHERE public_key = $1`,
        [userId],
      );

      if (result.rows.length === 0) return;

      const user = result.rows[0];

      if (user.email_enabled && user.email) {
        await sendEmail(user.email, message, type);
      }

      // Trigger SMS for critical events: repayment_due and loan_defaulted
      const smsEnabledForType =
        type === "repayment_due" || type === "loan_defaulted";

      if (user.sms_enabled && user.phone && smsEnabledForType) {
        await sendSMS(user.phone, message);
      }
    } catch (error) {
      logger.error("Error sending external notifications", { userId, error });
    }
  }

  /**
   * Returns the most recent notifications for a user (newest first).
   */
  async getNotificationsForUser(
    userId: string,
    limit = 50,
  ): Promise<Notification[]> {
    const result = await query(
      `SELECT id, user_id, type, title, message, loan_id, read, status, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit],
    );
    return result.rows.map(this.mapRow);
  }

  /**
   * Returns the unread notification count for a user.
   */
  async getUnreadCount(userId: string): Promise<number> {
    const result = await query(
      `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND status = 'unread'`,
      [userId],
    );
    return parseInt(result.rows[0]?.count ?? "0", 10);
  }

  /**
   * Marks specific notifications as read.
   * Only updates rows that belong to the given user to prevent cross-user access.
   */
  async markRead(userId: string, ids: number[]): Promise<void> {
    if (!ids.length) return;
    await query(
      `UPDATE notifications SET read = true, status = 'read'
       WHERE user_id = $1 AND id = ANY($2::int[]) AND status = 'unread'`,
      [userId, ids],
    );
  }

  /**
   * Marks all notifications for a user as read.
   */
  async markAllRead(userId: string): Promise<void> {
    await query(
      `UPDATE notifications SET read = true, status = 'read'
       WHERE user_id = $1 AND status = 'unread'`,
      [userId],
    );
  }

  /**
   * Archives specific notifications for a user.
   * Archived notifications are excluded from the main feed and cleaned up sooner.
   */
  async archiveNotifications(userId: string, ids: number[]): Promise<void> {
    if (!ids.length) return;
    await query(
      `UPDATE notifications SET read = true, status = 'archived'
       WHERE user_id = $1 AND id = ANY($2::int[]) AND status != 'archived'`,
      [userId, ids],
    );
  }

  /**
   * Notifies all admins of a dispute via:
   * 1. Email to ADMIN_EMAIL (if configured)
   * 2. In-app SSE push to each admin wallet currently subscribed
   * 3. Webhook POST to ADMIN_WEBHOOK_URL (if configured)
   */
  async notifyAdmins(params: {
    title: string;
    message: string;
    loanId?: number;
  }): Promise<void> {
    const { title, message, loanId } = params;

    // 1. Email the configured admin address
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      await sendEmail(adminEmail, message);
    } else {
      logger.warn("[Admin] ADMIN_EMAIL not set — logging dispute only", {
        title,
        message,
      });
    }

    // 2. Push SSE notification to every admin currently connected
    try {
      const adminResult = await query(
        `SELECT public_key FROM user_profiles WHERE role = 'admin'`,
        [],
      );

      for (const row of adminResult.rows) {
        const adminId = row.public_key as string;
        const result = await query(
          `INSERT INTO notifications (user_id, type, title, message, loan_id, status)
           VALUES ($1, 'loan_defaulted', $2, $3, $4, 'unread')
           RETURNING id, user_id, type, title, message, loan_id, read, status, created_at`,
          [adminId, title, message, loanId ?? null],
        );
        const notification = this.mapRow(result.rows[0]);
        this.broadcast(adminId, notification);
      }
    } catch (err) {
      logger.error("[Admin] Failed to persist/push admin notifications", {
        err,
      });
    }

    // 3. Optional webhook (Slack / Discord / custom)
    const webhookUrl = process.env.ADMIN_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: `[RemitLend] ${title}: ${message}` }),
        });
      } catch (err) {
        logger.error("[Admin] Webhook POST failed", { webhookUrl, err });
      }
    }
  }

  // ─── SSE helpers ────────────────────────────────────────────────────────────

  /**
   * Registers an SSE response stream for the given user.
   * Returns an unsubscribe function that should be called when the client
   * disconnects.
   */
  subscribe(userId: string, res: SseClient): () => void {
    if (!sseClients.has(userId)) {
      sseClients.set(userId, new Set());
    }
    sseClients.get(userId)!.add(res);

    return () => {
      sseClients.get(userId)?.delete(res);
      if (sseClients.get(userId)?.size === 0) {
        sseClients.delete(userId);
      }
    };
  }

  /**
   * Pushes a notification to all active SSE streams for the given user.
   */
  private broadcast(userId: string, notification: Notification): void {
    const clients = sseClients.get(userId);
    if (!clients?.size) return;

    const data = `data: ${JSON.stringify(notification)}\n\n`;
    for (const res of clients) {
      try {
        res.write(data);
      } catch (err) {
        logger.error("SSE write error", { userId, err });
        clients.delete(res);
      }
    }
  }

  /**
   * Deletes notifications older than the specified number of days.
   * @param retentionDays The number of days to keep notifications.
   * @returns The number of deleted notifications.
   */
  async deleteOldNotifications(retentionDays: number): Promise<number> {
    try {
      const result = await query(
        `DELETE FROM notifications
         WHERE created_at < NOW() - (INTERVAL '1 day' * $1)`,
        [retentionDays],
      );
      const deletedCount = result.rowCount ?? 0;
      if (deletedCount > 0) {
        logger.info(
          `Notification cleanup completed: ${deletedCount} rows deleted`,
          {
            retentionDays,
          },
        );
      }
      return deletedCount;
    } catch (error) {
      logger.error("Error during notification cleanup", {
        error,
        retentionDays,
      });
      return 0;
    }
  }

  /**
   * Deletes read and archived notifications older than the specified number of days.
   * Acknowledged notifications are cleaned up on a shorter retention cycle than unread ones.
   * @param retentionDays The number of days to keep read/archived notifications.
   * @returns The number of deleted notifications.
   */
  async deleteReadAndArchived(retentionDays: number): Promise<number> {
    try {
      const result = await query(
        `DELETE FROM notifications
         WHERE status IN ('read', 'archived')
           AND created_at < NOW() - (INTERVAL '1 day' * $1)`,
        [retentionDays],
      );
      const deletedCount = result.rowCount ?? 0;
      if (deletedCount > 0) {
        logger.info(
          `Read/archived notification cleanup completed: ${deletedCount} rows deleted`,
          { retentionDays },
        );
      }
      return deletedCount;
    } catch (error) {
      logger.error("Error during read/archived notification cleanup", {
        error,
        retentionDays,
      });
      return 0;
    }
  }

  // ─── Row mapper ──────────────────────────────────────────────────────────────

  private mapRow(row: Record<string, unknown>): Notification {
    const loanId = row.loan_id != null ? (row.loan_id as number) : undefined;
    const base = {
      id: row.id as number,
      userId: row.user_id as string,
      type: row.type as NotificationType,
      title: row.title as string,
      message: row.message as string,
      read: row.read as boolean,
      status:
        (row.status as NotificationStatus) ?? (row.read ? "read" : "unread"),
      createdAt: new Date(row.created_at as string),
    };
    return loanId !== undefined ? { ...base, loanId } : base;
  }
}

export const notificationService = new NotificationService();

let cleanupInterval: ReturnType<typeof setInterval> | undefined;

/**
 * Starts a periodic scheduler to clean up old notifications based on retention policy.
 */
export function startNotificationCleanupScheduler(): void {
  if (cleanupInterval) return;

  const retentionDays = parseInt(
    process.env.NOTIFICATION_RETENTION_DAYS || "90",
    10,
  );
  const readRetentionDays = parseInt(
    process.env.READ_NOTIFICATION_RETENTION_DAYS || "30",
    10,
  );
  const intervalMs = parseInt(
    process.env.NOTIFICATION_CLEANUP_INTERVAL_MS || String(24 * 60 * 60 * 1000), // Default: 24h
    10,
  );

  // Run once immediately on start to clear any backlog
  void notificationService.deleteOldNotifications(retentionDays);
  void notificationService.deleteReadAndArchived(readRetentionDays);

  cleanupInterval = setInterval(async () => {
    await notificationService.deleteOldNotifications(retentionDays);
    await notificationService.deleteReadAndArchived(readRetentionDays);
  }, intervalMs);

  logger.info("Notification cleanup scheduler started", {
    retentionDays,
    readRetentionDays,
    intervalMs,
  });
}

/**
 * Stops the notification cleanup scheduler.
 */
export function stopNotificationCleanupScheduler(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = undefined;
    logger.info("Notification cleanup scheduler stopped");
  }
}
