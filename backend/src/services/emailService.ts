import sgMail from "@sendgrid/mail";
import logger from "../utils/logger.js";

sgMail.setApiKey(process.env.SENDGRID_API_KEY || "");

export interface EmailNotification {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  templateId?: string;
  templateData?: Record<string, unknown>;
}

export interface LoanApplicationEmailData {
  borrowerName?: string | undefined;
  loanAmount: string;
  loanId: string;
  status: "requested" | "approved" | "rejected";
  nextPaymentDate?: string;
  totalOwed?: string;
}

export interface RepaymentReminderEmailData {
  borrowerName?: string;
  loanId: string;
  amountDue: string;
  dueDate: string;
  totalOwed: string;
  daysOverdue?: number;
}

export class EmailService {
  private readonly fromEmail = process.env.SENDGRID_FROM_EMAIL || "noreply@remitlend.com";

  async sendEmail(notification: EmailNotification): Promise<boolean> {
    try {
      const msg: sgMail.MailDataRequired = {
        to: notification.to,
        from: this.fromEmail,
        subject: notification.subject,
      };

      if (notification.templateId && notification.templateData) {
        msg.templateId = notification.templateId;
        msg.dynamicTemplateData = notification.templateData;
      } else {
        msg.text = notification.text || "";
        msg.html = notification.html || notification.text || "";
      }

      await sgMail.send(msg);
      logger.info("Email sent successfully", { to: notification.to, subject: notification.subject });
      return true;
    } catch (error) {
      logger.error("Failed to send email", { error, to: notification.to, subject: notification.subject });
      return false;
    }
  }

  async sendLoanApplicationNotification(email: string, data: LoanApplicationEmailData): Promise<boolean> {
    const subject = this.getLoanApplicationSubject(data.status);
    const { text, html } = this.generateLoanApplicationContent(data);

    return this.sendEmail({
      to: email,
      subject,
      text,
      html,
    });
  }

  async sendRepaymentReminder(email: string, data: RepaymentReminderEmailData): Promise<boolean> {
    const isOverdue = (data.daysOverdue || 0) > 0;
    const subject = isOverdue 
      ? `URGENT: Loan Payment Overdue - Loan ${data.loanId}`
      : `Reminder: Loan Payment Due - Loan ${data.loanId}`;

    const { text, html } = this.generateRepaymentReminderContent(data, isOverdue);

    return this.sendEmail({
      to: email,
      subject,
      text,
      html,
    });
  }

  private getLoanApplicationSubject(status: string): string {
    switch (status) {
      case "requested":
        return "Loan Application Received";
      case "approved":
        return "Congratulations! Your Loan Has Been Approved";
      case "rejected":
        return "Loan Application Update";
      default:
        return "Loan Application Status Update";
    }
  }

  private generateLoanApplicationContent(data: LoanApplicationEmailData): { text: string; html: string } {
    const text = `
Hello ${data.borrowerName || "Valued Customer"},

Your loan application status has been updated.

Loan Details:
- Loan ID: ${data.loanId}
- Amount: ${data.loanAmount}
- Status: ${data.status.toUpperCase()}

${this.getStatusSpecificMessage(data)}

Best regards,
The RemitLend Team
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Loan Application Update</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9fafb; }
        .loan-details { background: white; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .status { font-size: 18px; font-weight: bold; text-transform: uppercase; }
        .status.approved { color: #059669; }
        .status.rejected { color: #dc2626; }
        .status.requested { color: #2563eb; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>RemitLend</h1>
            <p>Loan Application Update</p>
        </div>
        <div class="content">
            <p>Hello ${data.borrowerName || "Valued Customer"},</p>
            <p>Your loan application status has been updated.</p>
            
            <div class="loan-details">
                <h3>Loan Details:</h3>
                <p><strong>Loan ID:</strong> ${data.loanId}</p>
                <p><strong>Amount:</strong> ${data.loanAmount}</p>
                <p><strong>Status:</strong> <span class="status ${data.status}">${data.status.toUpperCase()}</span></p>
            </div>
            
            <div>
                ${this.getStatusSpecificHtmlMessage(data)}
            </div>
        </div>
        <div class="footer">
            <p>&copy; 2024 RemitLend. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
    `.trim();

    return { text, html };
  }

  private generateRepaymentReminderContent(data: RepaymentReminderEmailData, isOverdue: boolean): { text: string; html: string } {
    const urgency = isOverdue ? "URGENT: " : "";
    const overdueInfo = isOverdue ? `\nThis payment is ${data.daysOverdue} days overdue.` : "";

    const text = `
${urgency}Hello ${data.borrowerName || "Valued Customer"},

This is a reminder that your loan payment is due.

Payment Details:
- Loan ID: ${data.loanId}
- Amount Due: ${data.amountDue}
- Due Date: ${data.dueDate}
- Total Outstanding: ${data.totalOwed}
${overdueInfo}

Please make your payment as soon as possible to avoid additional charges.

Best regards,
The RemitLend Team
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${urgency}Payment Reminder</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: ${isOverdue ? '#dc2626' : '#2563eb'}; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9fafb; }
        .payment-details { background: white; padding: 15px; border-radius: 8px; margin: 20px 0; }
        .overdue { color: #dc2626; font-weight: bold; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>RemitLend</h1>
            <p>${urgency}Payment Reminder</p>
        </div>
        <div class="content">
            <p>Hello ${data.borrowerName || "Valued Customer"},</p>
            <p>This is a reminder that your loan payment is due.</p>
            
            <div class="payment-details">
                <h3>Payment Details:</h3>
                <p><strong>Loan ID:</strong> ${data.loanId}</p>
                <p><strong>Amount Due:</strong> ${data.amountDue}</p>
                <p><strong>Due Date:</strong> ${data.dueDate}</p>
                <p><strong>Total Outstanding:</strong> ${data.totalOwed}</p>
                ${isOverdue ? `<p class="overdue">This payment is ${data.daysOverdue} days overdue.</p>` : ''}
            </div>
            
            <p>Please make your payment as soon as possible${isOverdue ? ' to avoid additional charges' : ''}.</p>
        </div>
        <div class="footer">
            <p>&copy; 2024 RemitLend. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
    `.trim();

    return { text, html };
  }

  private getStatusSpecificMessage(data: LoanApplicationEmailData): string {
    switch (data.status) {
      case "approved":
        return `
Congratulations! Your loan has been approved. The funds will be disbursed shortly.

${data.nextPaymentDate ? `Your first payment is due on: ${data.nextPaymentDate}` : ""}
${data.totalOwed ? `Total amount to be repaid: ${data.totalOwed}` : ""}
        `.trim();
      case "rejected":
        return `
We regret to inform you that your loan application has been rejected. 
This decision was based on our current lending criteria.

You may reapply after 30 days.
        `.trim();
      case "requested":
        return `
We have received your loan application and it is currently under review.
You will be notified of the decision within 2-3 business days.
        `.trim();
      default:
        return "";
    }
  }

  private getStatusSpecificHtmlMessage(data: LoanApplicationEmailData): string {
    switch (data.status) {
      case "approved":
        return `
<p>Congratulations! Your loan has been approved. The funds will be disbursed shortly.</p>
${data.nextPaymentDate ? `<p><strong>Your first payment is due on:</strong> ${data.nextPaymentDate}</p>` : ""}
${data.totalOwed ? `<p><strong>Total amount to be repaid:</strong> ${data.totalOwed}</p>` : ""}
        `.trim();
      case "rejected":
        return `
<p>We regret to inform you that your loan application has been rejected.</p>
<p>This decision was based on our current lending criteria.</p>
<p>You may reapply after 30 days.</p>
        `.trim();
      case "requested":
        return `
<p>We have received your loan application and it is currently under review.</p>
<p>You will be notified of the decision within 2-3 business days.</p>
        `.trim();
      default:
        return "";
    }
  }
}

export const emailService = new EmailService();
