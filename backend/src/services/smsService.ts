import twilio from "twilio";
import logger from "../utils/logger.js";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_FROM_NUMBER;

if (!accountSid || !authToken) {
  logger.warn("Twilio credentials not configured. SMS/WhatsApp notifications will be disabled.");
}

const client = twilio(accountSid, authToken);

export interface SmsNotification {
  to: string;
  body: string;
}

export interface WhatsAppNotification {
  to: string;
  body: string;
  mediaUrl?: string[];
}

export interface LoanApplicationSmsData {
  loanId: string;
  amount: string;
  status: "requested" | "approved" | "rejected";
}

export interface RepaymentReminderSmsData {
  loanId: string;
  amountDue: string;
  dueDate: string;
  daysOverdue?: number;
}

export class SmsService {
  async sendSms(notification: SmsNotification): Promise<boolean> {
    if (!accountSid || !authToken || !fromNumber) {
      logger.warn("SMS service not configured - skipping SMS send");
      return false;
    }

    try {
      const message = await client.messages.create({
        body: notification.body,
        from: fromNumber,
        to: notification.to,
      });

      logger.info("SMS sent successfully", { 
        to: notification.to, 
        sid: message.sid,
        body: notification.body.substring(0, 50) + "..."
      });
      return true;
    } catch (error) {
      logger.error("Failed to send SMS", { error, to: notification.to });
      return false;
    }
  }

  async sendWhatsApp(notification: WhatsAppNotification): Promise<boolean> {
    if (!accountSid || !authToken || !fromNumber) {
      logger.warn("WhatsApp service not configured - skipping WhatsApp send");
      return false;
    }

    try {
      const message = await client.messages.create({
        body: notification.body,
        from: `whatsapp:${fromNumber}`,
        to: `whatsapp:${notification.to}`,
        ...(notification.mediaUrl && { mediaUrl: notification.mediaUrl }),
      });

      logger.info("WhatsApp message sent successfully", { 
        to: notification.to, 
        sid: message.sid,
        body: notification.body.substring(0, 50) + "..."
      });
      return true;
    } catch (error) {
      logger.error("Failed to send WhatsApp message", { error, to: notification.to });
      return false;
    }
  }

  async sendLoanApplicationSms(phoneNumber: string, data: LoanApplicationSmsData): Promise<boolean> {
    const message = this.generateLoanApplicationSms(data);
    return this.sendSms({ to: phoneNumber, body: message });
  }

  async sendLoanApplicationWhatsApp(phoneNumber: string, data: LoanApplicationSmsData): Promise<boolean> {
    const message = this.generateLoanApplicationSms(data);
    return this.sendWhatsApp({ to: phoneNumber, body: message });
  }

  async sendRepaymentReminderSms(phoneNumber: string, data: RepaymentReminderSmsData): Promise<boolean> {
    const message = this.generateRepaymentReminderSms(data);
    return this.sendSms({ to: phoneNumber, body: message });
  }

  async sendRepaymentReminderWhatsApp(phoneNumber: string, data: RepaymentReminderSmsData): Promise<boolean> {
    const message = this.generateRepaymentReminderSms(data);
    return this.sendWhatsApp({ to: phoneNumber, body: message });
  }

  private generateLoanApplicationSms(data: LoanApplicationSmsData): string {
    const statusMessages = {
      requested: `Your loan application for ${data.amount} (ID: ${data.loanId}) has been received and is under review.`,
      approved: `Congratulations! Your loan for ${data.amount} (ID: ${data.loanId}) has been approved. Funds will be disbursed shortly.`,
      rejected: `Your loan application for ${data.amount} (ID: ${data.loanId}) has been rejected. You may reapply after 30 days.`
    };

    return `RemitLend: ${statusMessages[data.status]}`;
  }

  private generateRepaymentReminderSms(data: RepaymentReminderSmsData): string {
    const isOverdue = (data.daysOverdue || 0) > 0;
    const urgency = isOverdue ? "URGENT: " : "";
    const overdueInfo = isOverdue ? ` (${data.daysOverdue} days overdue)` : "";

    return `${urgency}RemitLend: Payment reminder for Loan ${data.loanId}. Amount due: ${data.amountDue}. Due date: ${data.dueDate}${overdueInfo}. Please make your payment as soon as possible.`;
  }
}

export class WhatsAppService {
  async sendLoanApplicationUpdate(phoneNumber: string, data: LoanApplicationSmsData): Promise<boolean> {
    const message = this.generateWhatsAppLoanMessage(data);
    return this.sendWhatsApp({ to: phoneNumber, body: message });
  }

  async sendLoanApplicationWhatsApp(phoneNumber: string, data: LoanApplicationSmsData): Promise<boolean> {
    return this.sendLoanApplicationUpdate(phoneNumber, data);
  }

  async sendRepaymentReminder(phoneNumber: string, data: RepaymentReminderSmsData): Promise<boolean> {
    const message = this.generateWhatsAppRepaymentMessage(data);
    return this.sendWhatsApp({ to: phoneNumber, body: message });
  }

  async sendRepaymentReminderWhatsApp(phoneNumber: string, data: RepaymentReminderSmsData): Promise<boolean> {
    return this.sendRepaymentReminder(phoneNumber, data);
  }

  async sendWhatsApp(notification: WhatsAppNotification): Promise<boolean> {
    if (!accountSid || !authToken || !fromNumber) {
      logger.warn("WhatsApp service not configured - skipping WhatsApp send");
      return false;
    }

    try {
      const message = await client.messages.create({
        body: notification.body,
        from: `whatsapp:${fromNumber}`,
        to: `whatsapp:${notification.to}`,
        ...(notification.mediaUrl && { mediaUrl: notification.mediaUrl }),
      });

      logger.info("WhatsApp message sent successfully", { 
        to: notification.to, 
        sid: message.sid,
        body: notification.body.substring(0, 50) + "..."
      });
      return true;
    } catch (error) {
      logger.error("Failed to send WhatsApp message", { error, to: notification.to });
      return false;
    }
  }

  private generateWhatsAppLoanMessage(data: LoanApplicationSmsData): string {
    const statusEmojis = {
      requested: "📋",
      approved: "✅",
      rejected: "❌"
    };

    const statusMessages = {
      requested: `Your loan application for ${data.amount} (ID: ${data.loanId}) has been received and is under review.`,
      approved: `Congratulations! Your loan for ${data.amount} (ID: ${data.loanId}) has been approved. Funds will be disbursed shortly.`,
      rejected: `Your loan application for ${data.amount} (ID: ${data.loanId}) has been rejected. You may reapply after 30 days.`
    };

    return `${statusEmojis[data.status]} *RemitLend Loan Update*\n\n${statusMessages[data.status]}\n\nLoan ID: ${data.loanId}\nAmount: ${data.amount}`;
  }

  private generateWhatsAppRepaymentMessage(data: RepaymentReminderSmsData): string {
    const isOverdue = (data.daysOverdue || 0) > 0;
    const emoji = isOverdue ? "⚠️" : "💰";
    const urgency = isOverdue ? "URGENT: " : "";
    const overdueInfo = isOverdue ? `\n⚠️ ${data.daysOverdue} days overdue` : "";

    return `${emoji} *${urgency}RemitLend Payment Reminder*\n\nLoan ID: ${data.loanId}\nAmount Due: ${data.amountDue}\nDue Date: ${data.dueDate}${overdueInfo}\n\nPlease make your payment as soon as possible${isOverdue ? " to avoid additional charges" : ""}.`;
  }
}

export const smsService = new SmsService();
export const whatsappService = new WhatsAppService();
