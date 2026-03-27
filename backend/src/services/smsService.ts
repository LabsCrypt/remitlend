import twilio from "twilio";
import logger from "../utils/logger.js";

export interface SMSConfig {
  accountSid: string;
  authToken: string;
  phoneNumber: string;
  whatsappFrom?: string | undefined;
}

export interface SMSMessage {
  to: string;
  body: string;
  useWhatsApp?: boolean;
}

export class SMSService {
  private client: twilio.Twilio | null = null;
  private config: SMSConfig;
  private initialized: boolean = false;

  constructor(config: SMSConfig) {
    this.config = config;
    this.initialize();
  }

  private initialize(): void {
    if (!this.config.accountSid || !this.config.authToken) {
      logger.warn(
        "Twilio credentials not provided. SMS service will be disabled.",
      );
      return;
    }

    try {
      this.client = twilio(this.config.accountSid, this.config.authToken);
      this.initialized = true;
      logger.info("SMS service initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize SMS service:", error);
    }
  }

  public async sendSMS(message: SMSMessage): Promise<boolean> {
    if (!this.initialized || !this.client) {
      logger.warn("SMS service not initialized. Skipping SMS send.");
      return false;
    }

    try {
      const from =
        message.useWhatsApp && this.config.whatsappFrom
          ? this.config.whatsappFrom
          : this.config.phoneNumber;

      const response = await this.client.messages.create({
        body: message.body,
        from,
        to: message.to,
      });

      logger.info("SMS sent successfully", {
        to: message.to,
        from,
        messageSid: response.sid,
        useWhatsApp: message.useWhatsApp,
      });
      return true;
    } catch (error) {
      logger.error("Failed to send SMS:", error);
      return false;
    }
  }

  public async sendLoanApplicationStatusUpdate(
    to: string,
    borrowerName: string,
    loanId: string,
    status: "approved" | "rejected" | "under_review",
    useWhatsApp: boolean = false,
  ): Promise<boolean> {
    const statusMessages = {
      approved: `🎉 Congratulations ${borrowerName}! Your loan application ${loanId} has been approved. Check your email for details.`,
      rejected: `Hi ${borrowerName}, your loan application ${loanId} was not approved. Contact support for more information.`,
      under_review: `Hi ${borrowerName}, your loan application ${loanId} is under review. We'll notify you of any updates.`,
    };

    return this.sendSMS({
      to,
      body: statusMessages[status],
      useWhatsApp,
    });
  }

  public async sendPaymentReminder(
    to: string,
    borrowerName: string,
    loanId: string,
    amount: string,
    currency: string,
    dueDate: string,
    daysOverdue?: number,
    useWhatsApp: boolean = false,
  ): Promise<boolean> {
    const isOverdue = daysOverdue !== undefined && daysOverdue > 0;

    let message: string;
    if (isOverdue) {
      message = `⚠️ ${borrowerName}, your payment of ${amount} ${currency} for loan ${loanId} is ${daysOverdue} days overdue. Please pay immediately to avoid fees.`;
    } else {
      message = `📅 Hi ${borrowerName}, reminder: payment of ${amount} ${currency} for loan ${loanId} is due on ${dueDate}. Please ensure funds are available.`;
    }

    return this.sendSMS({
      to,
      body: message,
      useWhatsApp,
    });
  }

  public async sendLoanDisbursementNotification(
    to: string,
    borrowerName: string,
    loanId: string,
    amount: string,
    currency: string,
    useWhatsApp: boolean = false,
  ): Promise<boolean> {
    const message = `💰 Great news ${borrowerName}! Your loan ${loanId} for ${amount} ${currency} has been disbursed. Check your account and email for details.`;

    return this.sendSMS({
      to,
      body: message,
      useWhatsApp,
    });
  }

  public async sendRepaymentConfirmation(
    to: string,
    borrowerName: string,
    loanId: string,
    amount: string,
    currency: string,
    remainingBalance?: string,
    useWhatsApp: boolean = false,
  ): Promise<boolean> {
    let message = `✅ Thank you ${borrowerName}! We received your payment of ${amount} ${currency} for loan ${loanId}.`;

    if (remainingBalance) {
      message += ` Remaining balance: ${remainingBalance} ${currency}.`;
    }

    return this.sendSMS({
      to,
      body: message,
      useWhatsApp,
    });
  }

  public async sendVerificationCode(
    to: string,
    code: string,
    useWhatsApp: boolean = false,
  ): Promise<boolean> {
    const message = `Your RemitLend verification code is: ${code}. This code will expire in 10 minutes. Do not share this code.`;

    return this.sendSMS({
      to,
      body: message,
      useWhatsApp,
    });
  }

  public async sendAccountAlert(
    to: string,
    borrowerName: string,
    alertType: "login" | "password_change" | "email_change" | "phone_change",
    details?: string,
    useWhatsApp: boolean = false,
  ): Promise<boolean> {
    const alertMessages = {
      login: `🔐 ${borrowerName}, a new login was detected on your RemitLend account. If this wasn't you, please contact support immediately.`,
      password_change: `🔒 Hi ${borrowerName}, your password was successfully changed. If this wasn't you, please contact support immediately.`,
      email_change: `📧 ${borrowerName}, your email address was successfully changed. If this wasn't you, please contact support immediately.`,
      phone_change: `📱 ${borrowerName}, your phone number was successfully changed. If this wasn't you, please contact support immediately.`,
    };

    let message = alertMessages[alertType];
    if (details) {
      message += ` Details: ${details}`;
    }

    return this.sendSMS({
      to,
      body: message,
      useWhatsApp,
    });
  }

  public async sendMarketingMessage(
    to: string,
    borrowerName: string,
    message: string,
    useWhatsApp: boolean = false,
  ): Promise<boolean> {
    const personalizedMessage = `Hi ${borrowerName}, ${message}`;

    return this.sendSMS({
      to,
      body: personalizedMessage,
      useWhatsApp,
    });
  }

  public isInitialized(): boolean {
    return this.initialized;
  }

  public async validatePhoneNumber(phoneNumber: string): Promise<boolean> {
    if (!this.initialized || !this.client) {
      return false;
    }

    try {
      const lookup = await this.client.lookups.v2
        .phoneNumbers(phoneNumber)
        .fetch();
      return !!lookup.phoneNumber;
    } catch (error) {
      logger.warn("Phone number validation failed:", error);
      return false;
    }
  }

  public async getCarrierInfo(phoneNumber: string): Promise<any> {
    if (!this.initialized || !this.client) {
      return null;
    }

    try {
      const lookup = await this.client.lookups.v2
        .phoneNumbers(phoneNumber)
        .fetch({ fields: "carrier" });
      return (lookup as any).carrier || null;
    } catch (error) {
      logger.warn("Failed to get carrier info:", error);
      return null;
    }
  }
}
