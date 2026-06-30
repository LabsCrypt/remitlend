import { query } from '../db/connection.js';
import logger from '../utils/logger.js';
import type { Response } from 'express';

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationType =
  | 'loan_approved'
  | 'repayment_due'
  | 'repayment_confirmed'
  | 'loan_defaulted'
  | 'loan_liquidated'
  | 'score_changed';

export type NotificationStatus = 'unread' | 'read' | 'archived';

export interface Notification {
  id: number;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  loanId?: number | undefined;
  actionUrl?: string | null;
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
  actionUrl?: string | undefined | null;
}

export interface NotificationPreferences {
  emailEnabled: boolean;
  smsEnabled: boolean;
  phone: string | null;
  perTypeOverrides: Record<string, boolean>;
  digestFrequency?: 'off' | 'daily' | 'weekly';
}

// ─── SSE subscriber registry ──────────────────────────────────────────────────
// Maps userId → set of SSE response streams currently listening.
// No persistence needed — streams are in-process only.

type SseClient = Response;
const sseClients = new Map<string, Set<SseClient>>();

// Lazy-init Twilio client — dynamic import avoids ESM/CJS interop issues in tests
async function getTwilioClient() {
  if (
    !process.env.TWILIO_ACCOUNT_SID ||
    !process.env.TWILIO_AUTH_TOKEN ||
    !process.env.TWILIO_PHONE_NUMBER
  ) {
    return null;
  }
  const { default: twilio } = await import('twilio');
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

// Lazy-init SendGrid — called once on first sendEmail
let _sgInitialized = false;
async function ensureSendGrid() {
  if (_sgInitialized) return;
  _sgInitialized = true;
  if (process.env.SENDGRID_API_KEY) {
    const sgMail = await import('@sendgrid/mail');
    sgMail.default.setApiKey(process.env.SENDGRID_API_KEY);
  }
}

function buildEmailTemplate(
  type: NotificationType,
  message: string,
): { subject: string; html: string } {
  const templates: Record<NotificationType, { subject: string; html: string }> = {
    loan_approved: {
      subject: 'Your loan has been approved — RemitLend',
      html: `<h2>Loan Approved</h2><p>${message}</p><p>Log in to view your loan details and repayment schedule.</p>`,
    },
    repayment_due: {
      subject: 'Repayment reminder — RemitLend',
      html: `<h2>Repayment Due Soon</h2><p>${message}</p><p>Please ensure funds are available to avoid a default.</p>`,
    },
    repayment_confirmed: {
      subject: 'Repayment confirmed — RemitLend',
      html: `<h2>Repayment Confirmed</h2><p>${message}</p><p>Thank you for your payment.</p>`,
    },
    loan_defaulted: {
      subject: 'Loan default notice — RemitLend',
      html: `<h2>Loan Defaulted</h2><p>${message}</p><p>Contact support immediately if you believe this is an error.</p>`,
    },
    loan_liquidated: {
      subject: 'Your loan has been liquidated — RemitLend',
      html: `<h2>Loan Liquidated</h2><p>${message}</p><p>Contact support if you have questions about the outcome.</p>`,
    },
    score_changed: {
      subject: 'Your credit score has changed — RemitLend',
      html: `<h2>Credit Score Update</h2><p>${message}</p><p>Log in to see your updated score and history.</p>`,
    },
  };

  return templates[type];
}

async function sendEmail(email: string, message: string, type?: NotificationType): Promise<void> {
  const fromEmail = process.env.FROM_EMAIL;

  if (!fromEmail) {
    logger.withContext().info('[Email] FROM_EMAIL not set', { email, message });
    return;
  }

  await ensureSendGrid();

  if (!process.env.SENDGRID_API_KEY) {
    logger
      .withContext()
      .info(`[Email] SendGrid not configured. Would send to ${email}: ${message}`);
    return;
  }

  const template = type
    ? buildEmailTemplate(type, message)
    : { subject: 'Notification from RemitLend', html: `<p>${message}</p>` };

  try {
    const sgMail = await import('@sendgrid/mail');
    await sgMail.default.send({
      to: email,
      from: fromEmail,
      subject: template.subject,
      html: template.html,
    });
    logger.withContext().info(`[Email] Sent to ${email}`, { subject: template.subject });
  } catch (error) {
    logger.withContext().error(`[Email] SendGrid failed for ${email}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    // Swallow error — email failure must not break the main flow
  }
}

async function sendSMS(phone: string, message: string) {
  const twilioClient = await getTwilioClient();
  if (!twilioClient || !process.env.TWILIO_PHONE_NUMBER) {
    logger.withContext().warn(`[SMS] Twilio not configured. Would send to ${phone}: ${message}`);
    return;
  }

  try {
    const result = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone,
    });
    logger.withContext().info(`[SMS] Sent to ${phone}: ${message}`, { sid: result.sid });
  } catch (error) {
    logger.withContext().error(`[SMS] Failed to send to ${phone}`, {
      error: error instanceof Error ? error.message : String(error),
      phone,
    });
    // Swallow error - don't fail the notification creation
  }
}

class NotificationService {
  async getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
    const result = await query(
      `SELECT email_enabled, sms_enabled, phone
       FROM user_profiles
       WHERE public_key = $1
       LIMIT 1`,
      [userId],
    );

    if (result.rows.length === 0) {
      return {
        emailEnabled: false,
        smsEnabled: false,
        phone: null,
        perTypeOverrides: {},
      };
    }

    const row = result.rows[0];
    return {
      emailEnabled: Boolean(row.email_enabled),
      smsEnabled: Boolean(row.sms_enabled),
      phone: (row.phone as string | null) ?? null,
      perTypeOverrides: {},
    };
  }

  async updateNotificationPreferences(
    userId: string,
    payload: Pick<NotificationPreferences, 'emailEnabled' | 'smsEnabled' | 'phone'>,
  ): Promise<NotificationPreferences> {
    const result = await query(
      `UPDATE user_profiles
       SET email_enabled = $2,
           sms_enabled = $3,
           phone = $4
       WHERE public_key = $1
       RETURNING email_enabled, sms_enabled, phone`,
      [userId, payload.emailEnabled, payload.smsEnabled, payload.phone],
    );

    const row = result.rows[0] ?? {
      email_enabled: payload.emailEnabled,
      sms_enabled: payload.smsEnabled,
      phone: payload.phone,
    };

    return {
      emailEnabled: Boolean(row.email_enabled),
      smsEnabled: Boolean(row.sms_enabled),
      phone: (row.phone as string | null) ?? null,
      perTypeOverrides: {},
    };
  }

  /**
   * Persists a new notification and pushes it to any active SSE subscribers
   * for that user.
   */
  async createNotification(params: CreateNotificationParams): Promise<Notification> {
    const { userId, type, title, message, loanId, actionUrl } = params;

    const resolvedActionUrl = actionUrl ?? (loanId != null ? `/loans/${loanId}` : null);

    const result = await query(
      `INSERT INTO notifications (user_id, type, title, message, loan_id, action_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'unread')
       RETURNING id, user_id, type, title, message, loan_id, action_url, read, status, created_at`,
      [userId, type, title, message, loanId ?? null, resolvedActionUrl],
    );

    const notification = this.mapRow(result.rows[0]);
    this.broadcast(userId, notification);

    // Also trigger external notifications
    await this.notifyUserExternal(userId, message, type);

    return notification;
  }

  /**
   * Batches repayment_due notifications per user based on digest frequency.
   * Returns grouped notifications by user and digest frequency.
   */
  async batchRepaymentNotificationsForDigest(
    notifications: Array<{ userId: string; message: string; loanId?: number }>,
  ): Promise<Map<string, Array<{ userId: string; message: string; loanId?: number }>>> {
    const grouped = new Map<string, Array<{ userId: string; message: string; loanId?: number }>>();

    for (const notif of notifications) {
      const prefResult = await query(
        `SELECT digest_frequency FROM user_notification_preferences WHERE user_id = $1`,
        [notif.userId],
      );

      const digestFrequency = prefResult.rows[0]?.digest_frequency ?? 'off';

      if (digestFrequency === 'off') {
        // Send immediately
        const key = `${notif.userId}:immediate`;
        if (!grouped.has(key)) {
          grouped.set(key, []);
        }
        grouped.get(key)!.push(notif);
      } else {
        // Batch for daily or weekly digest
        const key = `${notif.userId}:${digestFrequency}`;
        if (!grouped.has(key)) {
          grouped.set(key, []);
        }
        grouped.get(key)!.push(notif);
      }
    }

    return grouped;
  }

  /**
   * Sends external notifications (Email/SMS) based on user preferences.
   * SMS is triggered for repayment_due and loan_defaulted events.
   */
  private async notifyUserExternal(userId: string, message: string, type: NotificationType) {
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

      // Trigger SMS for critical events: repayment_due, loan_defaulted, and loan_liquidated
      const smsEnabledForType =
        type === 'repayment_due' || type === 'loan_defaulted' || type === 'loan_liquidated';

      if (user.sms_enabled && user.phone && smsEnabledForType) {
        await sendSMS(user.phone, message);
      }
    } catch (error) {
      logger.withContext().error('Error sending external notifications', { userId, error });
    }
  }

  /**
   * Returns the most recent notifications for a user (newest first).
   * Supports filtering by type, status, and date range.
   */
  async getNotificationsForUser(
    userId: string,
    limit = 50,
    type?: string,
    status?: string,
    from?: string,
    to?: string,
  ): Promise<Notification[]> {
    let whereClause = 'user_id = $1';
    const params: (string | number)[] = [userId];
    let paramIndex = 2;

    if (type) {
      whereClause += ` AND type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    if (status) {
      whereClause += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (from) {
      const fromDate = new Date(from);
      if (Number.isNaN(fromDate.getTime())) {
        throw new Error("Invalid 'from' date format");
      }
      whereClause += ` AND created_at >= $${paramIndex}`;
      params.push(fromDate.toISOString());
      paramIndex++;
    }

    if (to) {
      const toDate = new Date(to);
      if (Number.isNaN(toDate.getTime())) {
        throw new Error("Invalid 'to' date format");
      }
      whereClause += ` AND created_at <= $${paramIndex}`;
      params.push(toDate.toISOString());
      paramIndex++;
    }

    const result = await query(
      `SELECT id, user_id, type, title, message, loan_id, action_url, read, status, created_at
         FROM notifications
         WHERE ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${paramIndex}`,
      [...params, limit],
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
    return parseInt(result.rows[0]?.count ?? '0', 10);
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
  async notifyAdmins(params: { title: string; message: string; loanId?: number }): Promise<void> {
    const { title, message, loanId } = params;

    // 1. Email the configured admin address
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      await sendEmail(adminEmail, message);
    } else {
      logger.withContext().warn('[Admin] ADMIN_EMAIL not set — logging dispute only', {
        title,
        message,
      });
    }

    // 2. Push SSE notification to every admin currently connected
    try {
      const adminWallets = (process.env.ADMIN_WALLETS ?? '')
        .split(',')
        .map((w) => w.trim())
        .filter((w) => w.length > 0);

      for (const adminId of adminWallets) {
        const actionUrl = loanId != null ? `/loans/${loanId}` : null;
        const result = await query(
          `INSERT INTO notifications (user_id, type, title, message, loan_id, action_url, status)
           VALUES ($1, 'loan_defaulted', $2, $3, $4, $5, 'unread')
           RETURNING id, user_id, type, title, message, loan_id, action_url, read, status, created_at`,
          [adminId, title, message, loanId ?? null, actionUrl],
        );
        const notification = this.mapRow(result.rows[0]);
        this.broadcast(adminId, notification);
      }
    } catch (err) {
      logger.withContext().error('[Admin] Failed to persist/push admin notifications', {
        err,
      });
    }

    // 3. Optional webhook (Slack / Discord / custom)
    const webhookUrl = process.env.ADMIN_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `[RemitLend] ${title}: ${message}` }),
        });
      } catch (err) {
        logger.withContext().error('[Admin] Webhook POST failed', { webhookUrl, err });
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
        logger.withContext().error('SSE write error', { userId, err });
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
        logger.withContext().info(`Notification cleanup completed: ${deletedCount} rows deleted`, {
          retentionDays,
        });
      }
      return deletedCount;
    } catch (error) {
      logger.withContext().error('Error during notification cleanup', {
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
        logger
          .withContext()
          .info(`Read/archived notification cleanup completed: ${deletedCount} rows deleted`, {
            retentionDays,
          });
      }
      return deletedCount;
    } catch (error) {
      logger.withContext().error('Error during read/archived notification cleanup', {
        error,
        retentionDays,
      });
      return 0;
    }
  }

  // ─── Row mapper ──────────────────────────────────────────────────────────────

  private mapRow(row: Record<string, unknown>): Notification {
    const loanId = row.loan_id != null ? (row.loan_id as number) : undefined;
    const actionUrl = row.action_url != null ? (row.action_url as string) : undefined;
    const base = {
      id: row.id as number,
      userId: row.user_id as string,
      type: row.type as NotificationType,
      title: row.title as string,
      message: row.message as string,
      read: row.read as boolean,
      status: (row.status as NotificationStatus) ?? (row.read ? 'read' : 'unread'),
      createdAt: new Date(row.created_at as string),
    };
    // Keep optional fields omitted rather than null so the mapped shape is
    // consistent (loanId is treated the same way).
    const withLoan = loanId !== undefined ? { ...base, loanId } : base;
    return actionUrl !== undefined ? { ...withLoan, actionUrl } : withLoan;
  }
}

export const notificationService = new NotificationService();

let cleanupInterval: ReturnType<typeof setInterval> | undefined;

/**
 * Starts a periodic scheduler to clean up old notifications based on retention policy.
 */
export function startNotificationCleanupScheduler(): void {
  if (cleanupInterval) return;

  const retentionDays = parseInt(process.env.NOTIFICATION_RETENTION_DAYS || '90', 10);
  const readRetentionDays = parseInt(process.env.READ_NOTIFICATION_RETENTION_DAYS || '30', 10);
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

  logger.withContext().info('Notification cleanup scheduler started', {
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
    logger.withContext().info('Notification cleanup scheduler stopped');
  }
}
