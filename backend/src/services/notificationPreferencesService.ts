import { query } from "../db/connection.js";
import logger from "../utils/logger.js";

export interface NotificationPreferences {
  userId: string;
  email: {
    enabled: boolean;
    loanStatusUpdates: boolean;
    paymentReminders: boolean;
    paymentOverdue: boolean;
    loanDisbursement: boolean;
    marketing: boolean;
    accountAlerts: boolean;
  };
  sms: {
    enabled: boolean;
    loanStatusUpdates: boolean;
    paymentReminders: boolean;
    paymentOverdue: boolean;
    loanDisbursement: boolean;
    marketing: boolean;
    accountAlerts: boolean;
    useWhatsApp: boolean;
  };
  timezone: string;
  language: string;
}

export interface UpdateNotificationPreferencesDTO {
  email?: Partial<NotificationPreferences["email"]>;
  sms?: Partial<NotificationPreferences["sms"]>;
  timezone?: string;
  language?: string;
}

export class NotificationPreferencesService {
  private static instance: NotificationPreferencesService;

  public static getInstance(): NotificationPreferencesService {
    if (!NotificationPreferencesService.instance) {
      NotificationPreferencesService.instance =
        new NotificationPreferencesService();
    }
    return NotificationPreferencesService.instance;
  }

  public async getPreferences(
    userId: string,
  ): Promise<NotificationPreferences | null> {
    try {
      const result = await query(
        `SELECT 
          user_id,
          email_enabled,
          email_loan_status_updates,
          email_payment_reminders,
          email_payment_overdue,
          email_loan_disbursement,
          email_marketing,
          email_account_alerts,
          sms_enabled,
          sms_loan_status_updates,
          sms_payment_reminders,
          sms_payment_overdue,
          sms_loan_disbursement,
          sms_marketing,
          sms_account_alerts,
          sms_use_whatsapp,
          timezone,
          language
         FROM notification_preferences 
         WHERE user_id = $1`,
        [userId],
      );

      if (result.rows.length === 0) {
        return await this.createDefaultPreferences(userId);
      }

      const row = result.rows[0];

      return {
        userId: row.user_id,
        email: {
          enabled: row.email_enabled,
          loanStatusUpdates: row.email_loan_status_updates,
          paymentReminders: row.email_payment_reminders,
          paymentOverdue: row.email_payment_overdue,
          loanDisbursement: row.email_loan_disbursement,
          marketing: row.email_marketing,
          accountAlerts: row.email_account_alerts,
        },
        sms: {
          enabled: row.sms_enabled,
          loanStatusUpdates: row.sms_loan_status_updates,
          paymentReminders: row.sms_payment_reminders,
          paymentOverdue: row.sms_payment_overdue,
          loanDisbursement: row.sms_loan_disbursement,
          marketing: row.sms_marketing,
          accountAlerts: row.sms_account_alerts,
          useWhatsApp: row.sms_use_whatsapp,
        },
        timezone: row.timezone || "UTC",
        language: row.language || "en",
      };
    } catch (error) {
      logger.error("Failed to get notification preferences:", error);
      throw new Error("Failed to retrieve notification preferences");
    }
  }

  public async updatePreferences(
    userId: string,
    preferences: UpdateNotificationPreferencesDTO,
  ): Promise<NotificationPreferences> {
    try {
      // Get current preferences first
      const current = await this.getPreferences(userId);
      if (!current) {
        throw new Error("User preferences not found");
      }

      // Merge with new preferences
      const updated = {
        ...current,
        email: { ...current.email, ...preferences.email },
        sms: { ...current.sms, ...preferences.sms },
        timezone: preferences.timezone || current.timezone,
        language: preferences.language || current.language,
      };

      // Update in database
      await query(
        `UPDATE notification_preferences 
         SET 
           email_enabled = $1,
           email_loan_status_updates = $2,
           email_payment_reminders = $3,
           email_payment_overdue = $4,
           email_loan_disbursement = $5,
           email_marketing = $6,
           email_account_alerts = $7,
           sms_enabled = $8,
           sms_loan_status_updates = $9,
           sms_payment_reminders = $10,
           sms_payment_overdue = $11,
           sms_loan_disbursement = $12,
           sms_marketing = $13,
           sms_account_alerts = $14,
           sms_use_whatsapp = $15,
           timezone = $16,
           language = $17,
           updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $18`,
        [
          updated.email.enabled,
          updated.email.loanStatusUpdates,
          updated.email.paymentReminders,
          updated.email.paymentOverdue,
          updated.email.loanDisbursement,
          updated.email.marketing,
          updated.email.accountAlerts,
          updated.sms.enabled,
          updated.sms.loanStatusUpdates,
          updated.sms.paymentReminders,
          updated.sms.paymentOverdue,
          updated.sms.loanDisbursement,
          updated.sms.marketing,
          updated.sms.accountAlerts,
          updated.sms.useWhatsApp,
          updated.timezone,
          updated.language,
          userId,
        ],
      );

      logger.info("Notification preferences updated", { userId });
      return updated;
    } catch (error) {
      logger.error("Failed to update notification preferences:", error);
      throw new Error("Failed to update notification preferences");
    }
  }

  public async createDefaultPreferences(
    userId: string,
  ): Promise<NotificationPreferences> {
    try {
      const defaultPreferences: NotificationPreferences = {
        userId,
        email: {
          enabled: true,
          loanStatusUpdates: true,
          paymentReminders: true,
          paymentOverdue: true,
          loanDisbursement: true,
          marketing: false,
          accountAlerts: true,
        },
        sms: {
          enabled: true,
          loanStatusUpdates: true,
          paymentReminders: true,
          paymentOverdue: true,
          loanDisbursement: true,
          marketing: false,
          accountAlerts: true,
          useWhatsApp: false,
        },
        timezone: "UTC",
        language: "en",
      };

      await query(
        `INSERT INTO notification_preferences (
          user_id,
          email_enabled,
          email_loan_status_updates,
          email_payment_reminders,
          email_payment_overdue,
          email_loan_disbursement,
          email_marketing,
          email_account_alerts,
          sms_enabled,
          sms_loan_status_updates,
          sms_payment_reminders,
          sms_payment_overdue,
          sms_loan_disbursement,
          sms_marketing,
          sms_account_alerts,
          sms_use_whatsapp,
          timezone,
          language,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`,
        [
          defaultPreferences.userId,
          defaultPreferences.email.enabled,
          defaultPreferences.email.loanStatusUpdates,
          defaultPreferences.email.paymentReminders,
          defaultPreferences.email.paymentOverdue,
          defaultPreferences.email.loanDisbursement,
          defaultPreferences.email.marketing,
          defaultPreferences.email.accountAlerts,
          defaultPreferences.sms.enabled,
          defaultPreferences.sms.loanStatusUpdates,
          defaultPreferences.sms.paymentReminders,
          defaultPreferences.sms.paymentOverdue,
          defaultPreferences.sms.loanDisbursement,
          defaultPreferences.sms.marketing,
          defaultPreferences.sms.accountAlerts,
          defaultPreferences.sms.useWhatsApp,
          defaultPreferences.timezone,
          defaultPreferences.language,
        ],
      );

      logger.info("Default notification preferences created", { userId });
      return defaultPreferences;
    } catch (error) {
      logger.error("Failed to create default notification preferences:", error);
      throw new Error("Failed to create default notification preferences");
    }
  }

  public async deletePreferences(userId: string): Promise<void> {
    try {
      await query("DELETE FROM notification_preferences WHERE user_id = $1", [
        userId,
      ]);

      logger.info("Notification preferences deleted", { userId });
    } catch (error) {
      logger.error("Failed to delete notification preferences:", error);
      throw new Error("Failed to delete notification preferences");
    }
  }

  public async getUsersWithNotificationType(
    notificationType: keyof NotificationPreferences["email"] &
      keyof NotificationPreferences["sms"],
    channel: "email" | "sms" | "both",
  ): Promise<string[]> {
    try {
      let queryText = "";
      const params: any[] = [];

      if (channel === "email") {
        queryText = `
          SELECT user_id 
          FROM notification_preferences 
          WHERE email_enabled = true AND email_${this.camelToSnake(notificationType)} = true
        `;
      } else if (channel === "sms") {
        queryText = `
          SELECT user_id 
          FROM notification_preferences 
          WHERE sms_enabled = true AND sms_${this.camelToSnake(notificationType)} = true
        `;
      } else {
        queryText = `
          SELECT user_id 
          FROM notification_preferences 
          WHERE (email_enabled = true AND email_${this.camelToSnake(notificationType)} = true)
             OR (sms_enabled = true AND sms_${this.camelToSnake(notificationType)} = true)
        `;
      }

      const result = await query(queryText, params);
      return result.rows.map((row: any) => row.user_id);
    } catch (error) {
      logger.error("Failed to get users with notification type:", error);
      throw new Error("Failed to retrieve users with notification type");
    }
  }

  public async getUserContactInfo(userId: string): Promise<{
    email?: string;
    phone?: string;
    stellarPublicKey: string;
  } | null> {
    try {
      const result = await query(
        `SELECT email, phone, public_key 
         FROM user_profiles 
         WHERE public_key = $1`,
        [userId],
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        email: row.email,
        phone: row.phone,
        stellarPublicKey: row.public_key,
      };
    } catch (error) {
      logger.error("Failed to get user contact info:", error);
      throw new Error("Failed to retrieve user contact information");
    }
  }

  public async updateContactInfo(
    userId: string,
    email?: string,
    phone?: string,
  ): Promise<void> {
    try {
      await query(
        `UPDATE user_profiles 
         SET email = COALESCE($1, email),
             phone = COALESCE($2, phone),
             updated_at = CURRENT_TIMESTAMP
         WHERE public_key = $3`,
        [email, phone, userId],
      );

      logger.info("User contact info updated", {
        userId,
        hasEmail: !!email,
        hasPhone: !!phone,
      });
    } catch (error) {
      logger.error("Failed to update user contact info:", error);
      throw new Error("Failed to update user contact information");
    }
  }

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  }

  public async getNotificationStats(): Promise<{
    totalUsers: number;
    emailEnabled: number;
    smsEnabled: number;
    bothEnabled: number;
    whatsappEnabled: number;
  }> {
    try {
      const result = await query(`
        SELECT 
          COUNT(*) as total_users,
          COUNT(CASE WHEN email_enabled = true THEN 1 END) as email_enabled,
          COUNT(CASE WHEN sms_enabled = true THEN 1 END) as sms_enabled,
          COUNT(CASE WHEN email_enabled = true AND sms_enabled = true THEN 1 END) as both_enabled,
          COUNT(CASE WHEN sms_use_whatsapp = true THEN 1 END) as whatsapp_enabled
        FROM notification_preferences
      `);

      const row = result.rows[0];
      return {
        totalUsers: parseInt(row.total_users),
        emailEnabled: parseInt(row.email_enabled),
        smsEnabled: parseInt(row.sms_enabled),
        bothEnabled: parseInt(row.both_enabled),
        whatsappEnabled: parseInt(row.whatsapp_enabled),
      };
    } catch (error) {
      logger.error("Failed to get notification stats:", error);
      throw new Error("Failed to retrieve notification statistics");
    }
  }
}
