import { EmailService } from "./emailService.js";
import { SMSService } from "./smsService.js";
import {
  NotificationPreferencesService,
  NotificationPreferences,
} from "./notificationPreferencesService.js";
import logger from "../utils/logger.js";

export interface ExternalNotificationEvent {
  type:
    | "loan_status_update"
    | "payment_reminder"
    | "payment_overdue"
    | "loan_disbursement"
    | "repayment_confirmation"
    | "account_alert";
  userId: string;
  data: {
    loanId?: string;
    borrowerName?: string;
    loanAmount?: string;
    currency?: string;
    status?: "approved" | "rejected" | "under_review";
    dueDate?: string;
    amount?: string;
    daysOverdue?: number;
    disbursementDate?: string;
    remainingBalance?: string;
    alertType?: "login" | "password_change" | "email_change" | "phone_change";
    details?: string;
  };
  priority?: "low" | "medium" | "high";
}

export interface ExternalNotificationResult {
  success: boolean;
  emailSent: boolean;
  smsSent: boolean;
  errors?: string[];
}

export class ExternalNotificationService {
  private static instance: ExternalNotificationService;
  private emailService: EmailService;
  private smsService: SMSService;
  private preferencesService: NotificationPreferencesService;

  private constructor() {
    this.emailService = new EmailService({
      apiKey: process.env.SENDGRID_API_KEY || "",
      fromEmail: process.env.FROM_EMAIL || "noreply@remitlend.com",
      fromName: process.env.FROM_NAME || "RemitLend",
    });

    this.smsService = new SMSService({
      accountSid: process.env.TWILIO_ACCOUNT_SID || "",
      authToken: process.env.TWILIO_AUTH_TOKEN || "",
      phoneNumber: process.env.TWILIO_PHONE_NUMBER || "",
      whatsappFrom: process.env.TWILIO_WHATSAPP_FROM || undefined,
    });

    this.preferencesService = NotificationPreferencesService.getInstance();
  }

  public static getInstance(): ExternalNotificationService {
    if (!ExternalNotificationService.instance) {
      ExternalNotificationService.instance = new ExternalNotificationService();
    }
    return ExternalNotificationService.instance;
  }

  public async sendNotification(
    event: ExternalNotificationEvent,
  ): Promise<ExternalNotificationResult> {
    const result: ExternalNotificationResult = {
      success: false,
      emailSent: false,
      smsSent: false,
      errors: [],
    };

    try {
      // Get user preferences and contact info
      const [preferences, contactInfo] = await Promise.all([
        this.preferencesService.getPreferences(event.userId),
        this.preferencesService.getUserContactInfo(event.userId),
      ]);

      if (!preferences) {
        result.errors?.push("User preferences not found");
        return result;
      }

      if (!contactInfo) {
        result.errors?.push("User contact information not found");
        return result;
      }

      // Send notifications based on event type and user preferences
      const promises: Promise<boolean>[] = [];

      // Email notification
      if (this.shouldSendEmail(event, preferences, contactInfo)) {
        promises.push(this.sendEmailNotification(event, contactInfo));
      }

      // SMS notification
      if (this.shouldSendSMS(event, preferences, contactInfo)) {
        promises.push(
          this.sendSMSNotification(event, preferences, contactInfo),
        );
      }

      // Wait for all notifications to be sent
      const results = await Promise.allSettled(promises);

      // Process results
      let emailIndex = 0;
      const smsIndex = 0;

      if (this.shouldSendEmail(event, preferences, contactInfo)) {
        const emailResult = results[emailIndex];
        if (emailResult && emailResult.status === "fulfilled") {
          if (emailResult.value) {
            result.emailSent = true;
          }
        } else if (emailResult && emailResult.status === "rejected") {
          result.errors?.push(`Email failed: ${(emailResult as any).reason}`);
        }
        emailIndex++;
      }

      if (this.shouldSendSMS(event, preferences, contactInfo)) {
        const smsResult = results[smsIndex];
        if (smsResult && smsResult.status === "fulfilled") {
          if (smsResult.value) {
            result.smsSent = true;
          }
        } else if (smsResult && smsResult.status === "rejected") {
          result.errors?.push(`SMS failed: ${(smsResult as any).reason}`);
        }
      }

      result.success = result.emailSent || result.smsSent;

      if (result.success) {
        logger.info("External notification sent successfully", {
          userId: event.userId,
          type: event.type,
          emailSent: result.emailSent,
          smsSent: result.smsSent,
        });
      } else {
        logger.error("All external notification channels failed", {
          userId: event.userId,
          type: event.type,
          errors: result.errors,
        });
      }

      return result;
    } catch (error) {
      logger.error("Failed to send external notification:", error);
      result.errors?.push(`General error: ${error}`);
      return result;
    }
  }

  private shouldSendEmail(
    event: ExternalNotificationEvent,
    preferences: NotificationPreferences,
    contactInfo: { email?: string; phone?: string; stellarPublicKey: string },
  ): boolean {
    if (!contactInfo.email || !preferences.email.enabled) {
      return false;
    }

    switch (event.type) {
      case "loan_status_update":
        return preferences.email.loanStatusUpdates;
      case "payment_reminder":
        return preferences.email.paymentReminders;
      case "payment_overdue":
        return preferences.email.paymentOverdue;
      case "loan_disbursement":
        return preferences.email.loanDisbursement;
      case "repayment_confirmation":
        return preferences.email.accountAlerts;
      case "account_alert":
        return preferences.email.accountAlerts;
      default:
        return false;
    }
  }

  private shouldSendSMS(
    event: ExternalNotificationEvent,
    preferences: NotificationPreferences,
    contactInfo: { email?: string; phone?: string; stellarPublicKey: string },
  ): boolean {
    if (!contactInfo.phone || !preferences.sms.enabled) {
      return false;
    }

    switch (event.type) {
      case "loan_status_update":
        return preferences.sms.loanStatusUpdates;
      case "payment_reminder":
        return preferences.sms.paymentReminders;
      case "payment_overdue":
        return preferences.sms.paymentOverdue;
      case "loan_disbursement":
        return preferences.sms.loanDisbursement;
      case "repayment_confirmation":
        return preferences.sms.accountAlerts;
      case "account_alert":
        return preferences.sms.accountAlerts;
      default:
        return false;
    }
  }

  private async sendEmailNotification(
    event: ExternalNotificationEvent,
    contactInfo: { email?: string; phone?: string; stellarPublicKey: string },
  ): Promise<boolean> {
    switch (event.type) {
      case "loan_status_update":
        return this.emailService.sendLoanApplicationStatusUpdate(
          contactInfo.email!,
          event.data.borrowerName || "Valued Customer",
          event.data.loanId!,
          event.data.status!,
          event.data.loanAmount,
          event.data.currency,
        );

      case "payment_reminder":
      case "payment_overdue":
        return this.emailService.sendPaymentReminder(
          contactInfo.email!,
          event.data.borrowerName || "Valued Customer",
          event.data.loanId!,
          event.data.amount!,
          event.data.currency!,
          event.data.dueDate!,
          event.data.daysOverdue,
        );

      case "loan_disbursement":
        return this.emailService.sendLoanDisbursementNotification(
          contactInfo.email!,
          event.data.borrowerName || "Valued Customer",
          event.data.loanId!,
          event.data.amount!,
          event.data.currency!,
          event.data.disbursementDate!,
        );

      default:
        logger.warn("Unsupported email notification type:", event.type);
        return false;
    }
  }

  private async sendSMSNotification(
    event: ExternalNotificationEvent,
    preferences: NotificationPreferences,
    contactInfo: { email?: string; phone?: string; stellarPublicKey: string },
  ): Promise<boolean> {
    const useWhatsApp = preferences.sms.useWhatsApp;

    switch (event.type) {
      case "loan_status_update":
        return this.smsService.sendLoanApplicationStatusUpdate(
          contactInfo.phone!,
          event.data.borrowerName || "Valued Customer",
          event.data.loanId!,
          event.data.status!,
          useWhatsApp,
        );

      case "payment_reminder":
      case "payment_overdue":
        return this.smsService.sendPaymentReminder(
          contactInfo.phone!,
          event.data.borrowerName || "Valued Customer",
          event.data.loanId!,
          event.data.amount!,
          event.data.currency!,
          event.data.dueDate!,
          event.data.daysOverdue,
          useWhatsApp,
        );

      case "loan_disbursement":
        return this.smsService.sendLoanDisbursementNotification(
          contactInfo.phone!,
          event.data.borrowerName || "Valued Customer",
          event.data.loanId!,
          event.data.amount!,
          event.data.currency!,
          useWhatsApp,
        );

      case "repayment_confirmation":
        return this.smsService.sendRepaymentConfirmation(
          contactInfo.phone!,
          event.data.borrowerName || "Valued Customer",
          event.data.loanId!,
          event.data.amount!,
          event.data.currency!,
          event.data.remainingBalance,
          useWhatsApp,
        );

      case "account_alert":
        return this.smsService.sendAccountAlert(
          contactInfo.phone!,
          event.data.borrowerName || "Valued Customer",
          event.data.alertType!,
          event.data.details,
          useWhatsApp,
        );

      default:
        logger.warn("Unsupported SMS notification type:", event.type);
        return false;
    }
  }

  public async sendBulkNotifications(
    events: ExternalNotificationEvent[],
  ): Promise<ExternalNotificationResult[]> {
    const results = await Promise.allSettled(
      events.map((event) => this.sendNotification(event)),
    );

    return results.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      } else {
        return {
          success: false,
          emailSent: false,
          smsSent: false,
          errors: [`Bulk send error: ${result.reason}`],
        };
      }
    });
  }

  public async sendVerificationCode(
    userId: string,
    code: string,
    channel: "email" | "sms" | "both",
  ): Promise<{ emailSent: boolean; smsSent: boolean }> {
    const contactInfo =
      await this.preferencesService.getUserContactInfo(userId);
    if (!contactInfo) {
      throw new Error("User contact information not found");
    }

    const result = { emailSent: false, smsSent: false };

    if ((channel === "email" || channel === "both") && contactInfo.email) {
      result.emailSent = await this.emailService.sendEmail({
        to: contactInfo.email,
        subject: "Your RemitLend Verification Code",
        html: `
          <h2>Verification Code</h2>
          <p>Your verification code is: <strong>${code}</strong></p>
          <p>This code will expire in 10 minutes. Do not share this code with anyone.</p>
        `,
      });
    }

    if ((channel === "sms" || channel === "both") && contactInfo.phone) {
      result.smsSent = await this.smsService.sendVerificationCode(
        contactInfo.phone,
        code,
      );
    }

    return result;
  }

  public async testNotificationServices(): Promise<{
    email: boolean;
    sms: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];
    let emailWorking = false;
    let smsWorking = false;

    // Test email service
    if (this.emailService.isInitialized()) {
      try {
        emailWorking = await this.emailService.sendEmail({
          to: "test@example.com",
          subject: "Test Email",
          html: "<p>This is a test email from RemitLend.</p>",
        });
      } catch (error) {
        errors.push(`Email test failed: ${error}`);
      }
    } else {
      errors.push("Email service not initialized");
    }

    // Test SMS service
    if (this.smsService.isInitialized()) {
      try {
        smsWorking = await this.smsService.sendSMS({
          to: "+1234567890",
          body: "This is a test SMS from RemitLend.",
        });
      } catch (error) {
        errors.push(`SMS test failed: ${error}`);
      }
    } else {
      errors.push("SMS service not initialized");
    }

    return {
      email: emailWorking,
      sms: smsWorking,
      errors,
    };
  }

  public getServiceStatus(): {
    email: boolean;
    sms: boolean;
    whatsapp: boolean;
  } {
    return {
      email: this.emailService.isInitialized(),
      sms: this.smsService.isInitialized(),
      whatsapp:
        this.smsService.isInitialized() && !!process.env.TWILIO_WHATSAPP_FROM,
    };
  }
}
