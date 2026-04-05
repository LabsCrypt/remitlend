import sgMail from "@sendgrid/mail";
import logger from "../utils/logger.js";

export interface EmailConfig {
  apiKey: string;
  fromEmail: string;
  fromName: string;
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  templateId?: string;
  templateData?: Record<string, any>;
}

export class EmailService {
  private config: EmailConfig;
  private initialized: boolean = false;

  constructor(config: EmailConfig) {
    this.config = config;
    this.initialize();
  }

  private initialize(): void {
    if (!this.config.apiKey) {
      logger.warn(
        "SendGrid API key not provided. Email service will be disabled.",
      );
      return;
    }

    try {
      sgMail.setApiKey(this.config.apiKey);
      this.initialized = true;
      logger.info("Email service initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize email service:", error);
    }
  }

  public async sendEmail(message: EmailMessage): Promise<boolean> {
    if (!this.initialized) {
      logger.warn("Email service not initialized. Skipping email send.");
      return false;
    }

    try {
      const msg: sgMail.MailDataRequired = {
        to: Array.isArray(message.to) ? message.to : [message.to],
        from: {
          email: this.config.fromEmail,
          name: this.config.fromName,
        },
        subject: message.subject,
        html: message.html,
        text: message.text || this.htmlToText(message.html),
      };

      if (message.templateId && message.templateData) {
        msg.templateId = message.templateId;
        msg.dynamicTemplateData = message.templateData;
        delete msg.html;
        delete msg.text;
        delete msg.subject;
      }

      const response = await sgMail.send(msg);
      logger.info("Email sent successfully", {
        to: message.to,
        subject: message.subject,
        messageId: response[0]?.headers["x-message-id"],
      });
      return true;
    } catch (error) {
      logger.error("Failed to send email:", error);
      return false;
    }
  }

  public async sendLoanApplicationStatusUpdate(
    to: string,
    borrowerName: string,
    loanId: string,
    status: "approved" | "rejected" | "under_review",
    loanAmount?: string,
    currency?: string,
  ): Promise<boolean> {
    const statusConfig = {
      approved: {
        subject: "🎉 Your Loan Application Has Been Approved!",
        color: "#10b981",
        message: "Congratulations! Your loan application has been approved.",
        action: "View Your Loan",
      },
      rejected: {
        subject: "Loan Application Update",
        color: "#ef4444",
        message:
          "We regret to inform you that your loan application was not approved.",
        action: "View Application",
      },
      under_review: {
        subject: "Your Loan Application is Under Review",
        color: "#f59e0b",
        message: "Your loan application is currently being reviewed.",
        action: "Track Status",
      },
    };

    const config = statusConfig[status];
    const html = this.generateLoanStatusEmail(
      borrowerName,
      loanId,
      status,
      loanAmount,
      currency,
      config,
    );

    return this.sendEmail({
      to,
      subject: config.subject,
      html,
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
  ): Promise<boolean> {
    const isOverdue = daysOverdue !== undefined && daysOverdue > 0;
    const subject = isOverdue
      ? `⚠️ Payment Overdue - ${daysOverdue} days`
      : "📅 Payment Reminder Due Soon";

    const html = this.generatePaymentReminderEmail(
      borrowerName,
      loanId,
      amount,
      currency,
      dueDate,
      daysOverdue,
    );

    return this.sendEmail({
      to,
      subject,
      html,
    });
  }

  public async sendLoanDisbursementNotification(
    to: string,
    borrowerName: string,
    loanId: string,
    amount: string,
    currency: string,
    disbursementDate: string,
  ): Promise<boolean> {
    const html = this.generateDisbursementEmail(
      borrowerName,
      loanId,
      amount,
      currency,
      disbursementDate,
    );

    return this.sendEmail({
      to,
      subject: "💰 Funds Disbursed - Your Loan is Active",
      html,
    });
  }

  private generateLoanStatusEmail(
    borrowerName: string,
    loanId: string,
    status: string,
    loanAmount?: string,
    currency?: string,
    config?: any,
  ): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Loan Application Status</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center; color: white; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
        .status-badge { display: inline-block; padding: 8px 16px; border-radius: 20px; font-weight: bold; color: white; background: ${config?.color || "#6b7280"}; }
        .loan-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .button { display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; }
        .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>RemitLend</h1>
            <p>Borderless P2P Lending</p>
        </div>
        <div class="content">
            <h2>Hello ${borrowerName},</h2>
            <p>${config?.message || "Your loan application status has been updated."}</p>
            
            <div class="status-badge">${status.toUpperCase()}</div>
            
            ${
              loanAmount && currency
                ? `
            <div class="loan-details">
                <h3>Loan Details</h3>
                <p><strong>Loan ID:</strong> ${loanId}</p>
                <p><strong>Amount:</strong> ${loanAmount} ${currency}</p>
            </div>
            `
                : ""
            }
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="https://remitlend.com/loans/${loanId}" class="button">${config?.action || "View Loan"}</a>
            </div>
            
            <p>If you have any questions, please contact our support team.</p>
        </div>
        <div class="footer">
            <p>&copy; 2024 RemitLend. All rights reserved.</p>
            <p>This is an automated message. Please do not reply to this email.</p>
        </div>
    </div>
</body>
</html>`;
  }

  private generatePaymentReminderEmail(
    borrowerName: string,
    loanId: string,
    amount: string,
    currency: string,
    dueDate: string,
    daysOverdue?: number,
  ): string {
    const isOverdue = daysOverdue !== undefined && daysOverdue > 0;
    const urgencyColor = isOverdue ? "#ef4444" : "#f59e0b";

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment Reminder</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center; color: white; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
        .payment-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid ${urgencyColor}; }
        .amount { font-size: 24px; font-weight: bold; color: ${urgencyColor}; }
        .button { display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; }
        .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>RemitLend</h1>
            <p>Borderless P2P Lending</p>
        </div>
        <div class="content">
            <h2>Hello ${borrowerName},</h2>
            <p>${
              isOverdue
                ? `Your payment is ${daysOverdue} days overdue. Please make your payment as soon as possible to avoid additional fees.`
                : "You have a payment coming up soon. Please ensure you have sufficient funds available."
            }</p>
            
            <div class="payment-details">
                <h3>Payment Details</h3>
                <p><strong>Loan ID:</strong> ${loanId}</p>
                <p><strong>Amount Due:</strong> <span class="amount">${amount} ${currency}</span></p>
                <p><strong>Due Date:</strong> ${dueDate}</p>
                ${isOverdue ? `<p><strong>Days Overdue:</strong> ${daysOverdue}</p>` : ""}
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="https://remitlend.com/repay/${loanId}" class="button">Make Payment Now</a>
            </div>
            
            <p>If you have already made this payment, please disregard this notice.</p>
        </div>
        <div class="footer">
            <p>&copy; 2024 RemitLend. All rights reserved.</p>
            <p>This is an automated message. Please do not reply to this email.</p>
        </div>
    </div>
</body>
</html>`;
  }

  private generateDisbursementEmail(
    borrowerName: string,
    loanId: string,
    amount: string,
    currency: string,
    disbursementDate: string,
  ): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Loan Disbursement</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center; color: white; }
        .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
        .disbursement-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981; }
        .amount { font-size: 24px; font-weight: bold; color: #10b981; }
        .button { display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; }
        .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>RemitLend</h1>
            <p>Borderless P2P Lending</p>
        </div>
        <div class="content">
            <h2>Hello ${borrowerName},</h2>
            <p>Great news! Your loan has been approved and the funds have been disbursed to your account.</p>
            
            <div class="disbursement-details">
                <h3>Disbursement Details</h3>
                <p><strong>Loan ID:</strong> ${loanId}</p>
                <p><strong>Amount Disbursed:</strong> <span class="amount">${amount} ${currency}</span></p>
                <p><strong>Disbursement Date:</strong> ${disbursementDate}</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="https://remitlend.com/loans/${loanId}" class="button">View Your Loan</a>
            </div>
            
            <p>Please remember to make your payments on time to maintain a good credit score.</p>
        </div>
        <div class="footer">
            <p>&copy; 2024 RemitLend. All rights reserved.</p>
            <p>This is an automated message. Please do not reply to this email.</p>
        </div>
    </div>
</body>
</html>`;
  }

  private htmlToText(html: string): string {
    return html
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  public isInitialized(): boolean {
    return this.initialized;
  }
}
