import { query } from "../db/connection.js";
import { emailService, LoanApplicationEmailData } from "./emailService.js";
import { smsService, whatsappService, LoanApplicationSmsData } from "./smsService.js";
import { createUserProfileIfNeeded } from "../controllers/notificationController.js";
import { IndexedLoanEvent } from "./webhookService.js";
import logger from "../utils/logger.js";

interface UserNotificationPreferences {
  email?: string;
  phoneNumber?: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
}

export class LoanEventNotifier {
  async notifyLoanApplicationStatusChange(event: IndexedLoanEvent): Promise<void> {
    try {
      logger.info("Processing loan application status change notification", {
        eventType: event.eventType,
        loanId: event.loanId,
        borrower: event.borrower,
      });

      // Ensure user profile exists
      await createUserProfileIfNeeded(event.borrower);

      // Get user notification preferences
      const preferences = await this.getUserNotificationPreferences(event.borrower);
      
      if (!preferences) {
        logger.warn("No notification preferences found for user", { borrower: event.borrower });
        return;
      }

      // Prepare notification data
      const notificationData = this.prepareLoanApplicationNotificationData(event);

      // Send notifications based on user preferences
      const results = await this.sendLoanApplicationNotifications(preferences, notificationData);

      logger.info("Loan application status notifications sent", {
        eventType: event.eventType,
        loanId: event.loanId,
        borrower: event.borrower,
        results,
      });

    } catch (error) {
      logger.error("Failed to send loan application status notification", {
        eventType: event.eventType,
        loanId: event.loanId,
        borrower: event.borrower,
        error,
      });
    }
  }

  private async getUserNotificationPreferences(borrower: string): Promise<UserNotificationPreferences | null> {
    try {
      const result = await query(
        `SELECT 
          email,
          phone_number,
          email_notifications_enabled,
          sms_notifications_enabled,
          whatsapp_notifications_enabled
        FROM user_profiles
        WHERE public_key = $1`,
        [borrower],
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];

      return {
        email: row.email,
        phoneNumber: row.phone_number,
        emailEnabled: row.email_notifications_enabled,
        smsEnabled: row.sms_notifications_enabled,
        whatsappEnabled: row.whatsapp_notifications_enabled,
      };
    } catch (error) {
      logger.error("Failed to get user notification preferences", { error, borrower });
      return null;
    }
  }

  private prepareLoanApplicationNotificationData(event: IndexedLoanEvent): {
    emailData: LoanApplicationEmailData;
    smsData: LoanApplicationSmsData;
  } {
    const status = this.mapEventTypeToStatus(event.eventType);
    
    const emailData: LoanApplicationEmailData = {
      borrowerName: undefined,
      loanAmount: event.amount || "0",
      loanId: event.loanId?.toString() || "unknown",
      status,
    };

    const smsData: LoanApplicationSmsData = {
      loanId: event.loanId?.toString() || "unknown",
      amount: event.amount || "0",
      status,
    };

    return { emailData, smsData };
  }

  private mapEventTypeToStatus(eventType: string): "requested" | "approved" | "rejected" {
    switch (eventType) {
      case "LoanRequested":
        return "requested";
      case "LoanApproved":
        return "approved";
      case "LoanRejected":
        return "rejected";
      default:
        return "requested";
    }
  }

  private async sendLoanApplicationNotifications(
    preferences: UserNotificationPreferences,
    data: { emailData: LoanApplicationEmailData; smsData: LoanApplicationSmsData },
  ): Promise<{ email: boolean; sms: boolean; whatsapp: boolean }> {
    const results = { email: false, sms: false, whatsapp: false };

    // Send email notification
    if (preferences.emailEnabled && preferences.email) {
      try {
        const emailData = {
          ...data.emailData,
          borrowerName: preferences.email.split("@")[0] || "Valued Customer",
        };
        
        results.email = await emailService.sendLoanApplicationNotification(preferences.email, emailData);
      } catch (error) {
        logger.error("Failed to send email notification", { error });
      }
    }

    // Send SMS notification
    if (preferences.smsEnabled && preferences.phoneNumber) {
      try {
        results.sms = await smsService.sendLoanApplicationSms(preferences.phoneNumber, data.smsData);
      } catch (error) {
        logger.error("Failed to send SMS notification", { error });
      }
    }

    // Send WhatsApp notification
    if (preferences.whatsappEnabled && preferences.phoneNumber) {
      try {
        results.whatsapp = await whatsappService.sendLoanApplicationWhatsApp(preferences.phoneNumber, data.smsData);
      } catch (error) {
        logger.error("Failed to send WhatsApp notification", { error });
      }
    }

    return results;
  }

  async notifyLoanDisbursed(event: IndexedLoanEvent): Promise<void> {
    try {
      logger.info("Processing loan disbursed notification", {
        loanId: event.loanId,
        borrower: event.borrower,
        amount: event.amount,
      });

      // Ensure user profile exists
      await createUserProfileIfNeeded(event.borrower);

      // Get user notification preferences
      const preferences = await this.getUserNotificationPreferences(event.borrower);
      
      if (!preferences) {
        logger.warn("No notification preferences found for user", { borrower: event.borrower });
        return;
      }

      // Prepare disbursal notification data
      const emailData: LoanApplicationEmailData = {
        borrowerName: preferences.email?.split("@")[0] || "Valued Customer",
        loanAmount: event.amount || "0",
        loanId: event.loanId?.toString() || "unknown",
        status: "approved",
      };

      const smsData: LoanApplicationSmsData = {
        loanId: event.loanId?.toString() || "unknown",
        amount: event.amount || "0",
        status: "approved",
      };

      // Send notifications
      const results = await this.sendLoanApplicationNotifications(preferences, { emailData, smsData });

      logger.info("Loan disbursed notifications sent", {
        loanId: event.loanId,
        borrower: event.borrower,
        results,
      });

    } catch (error) {
      logger.error("Failed to send loan disbursed notification", {
        loanId: event.loanId,
        borrower: event.borrower,
        error,
      });
    }
  }

  async notifyLoanRepaid(event: IndexedLoanEvent): Promise<void> {
    try {
      logger.info("Processing loan repaid notification", {
        loanId: event.loanId,
        borrower: event.borrower,
        amount: event.amount,
      });

      // Ensure user profile exists
      await createUserProfileIfNeeded(event.borrower);

      // Get user notification preferences
      const preferences = await this.getUserNotificationPreferences(event.borrower);
      
      if (!preferences) {
        logger.warn("No notification preferences found for user", { borrower: event.borrower });
        return;
      }

      // Send repayment confirmation email
      if (preferences.emailEnabled && preferences.email) {
        try {
          const success = await emailService.sendEmail({
            to: preferences.email,
            subject: `Payment Received - Loan ${event.loanId}`,
            text: `
Hello ${preferences.email.split("@")[0] || "Valued Customer"},

We have received your payment of ${event.amount} for Loan ${event.loanId}.

Thank you for your prompt payment!

Best regards,
The RemitLend Team
            `.trim(),
            html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment Received</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #059669; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9fafb; }
        .payment-details { background: white; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>RemitLend</h1>
            <p>Payment Received</p>
        </div>
        <div class="content">
            <p>Hello ${preferences.email.split("@")[0] || "Valued Customer"},</p>
            <p>We have received your payment successfully.</p>
            
            <div class="payment-details">
                <h3>Payment Details:</h3>
                <p><strong>Loan ID:</strong> ${event.loanId}</p>
                <p><strong>Amount Received:</strong> ${event.amount}</p>
                <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
            </div>
            
            <p>Thank you for your prompt payment!</p>
        </div>
        <div class="footer">
            <p>&copy; 2024 RemitLend. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
            `.trim(),
          });

          if (success) {
            logger.info("Repayment confirmation email sent", { borrower: event.borrower, loanId: event.loanId });
          }
        } catch (error) {
          logger.error("Failed to send repayment confirmation email", { error });
        }
      }

      // Send SMS notification
      if (preferences.smsEnabled && preferences.phoneNumber) {
        try {
          const success = await smsService.sendSms({
            to: preferences.phoneNumber,
            body: `RemitLend: We have received your payment of ${event.amount} for Loan ${event.loanId}. Thank you!`,
          });

          if (success) {
            logger.info("Repayment confirmation SMS sent", { borrower: event.borrower, loanId: event.loanId });
          }
        } catch (error) {
          logger.error("Failed to send repayment confirmation SMS", { error });
        }
      }

    } catch (error) {
      logger.error("Failed to send loan repaid notification", {
        loanId: event.loanId,
        borrower: event.borrower,
        error,
      });
    }
  }
}

export const loanEventNotifier = new LoanEventNotifier();
