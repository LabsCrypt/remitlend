import cron from "node-cron";
import { query } from "../db/connection.js";
import { emailService } from "./emailService.js";
import { smsService, whatsappService } from "./smsService.js";
import logger from "../utils/logger.js";

interface UserNotificationPreferences {
  email: string;
  phoneNumber?: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
}

interface LoanWithDueDate {
  loanId: string;
  borrower: string;
  principal: number;
  accruedInterest: number;
  totalRepaid: number;
  totalOwed: number;
  nextPaymentDeadline: string;
  approvedAt: string;
  daysUntilDue: number;
  daysOverdue?: number;
}

export class NotificationScheduler {
  private isRunning = false;

  start(): void {
    if (this.isRunning) {
      logger.warn("Notification scheduler is already running");
      return;
    }

    logger.info("Starting notification scheduler");

    // Run every day at 9:00 AM
    cron.schedule("0 9 * * *", async () => {
      await this.checkUpcomingPayments();
    });

    // Run every 6 hours for overdue payments
    cron.schedule("0 */6 * * *", async () => {
      await this.checkOverduePayments();
    });

    // Run every hour for urgent notifications (1 day before due)
    cron.schedule("0 * * * *", async () => {
      await this.checkUrgentPayments();
    });

    this.isRunning = true;
    logger.info("Notification scheduler started successfully");
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    cron.getTasks().forEach((task) => task.stop());
    this.isRunning = false;
    logger.info("Notification scheduler stopped");
  }

  private async checkUpcomingPayments(): Promise<void> {
    try {
      logger.info("Checking upcoming loan payments");

      const loans = await this.getLoansWithUpcomingPayments(7); // 7 days ahead
      const results = await this.processLoanNotifications(loans, "upcoming");

      logger.info("Upcoming payment check completed", {
        totalLoans: loans.length,
        notificationsSent: results.sent,
        errors: results.errors,
      });
    } catch (error) {
      logger.error("Error checking upcoming payments", { error });
    }
  }

  private async checkOverduePayments(): Promise<void> {
    try {
      logger.info("Checking overdue loan payments");

      const loans = await this.getOverdueLoans();
      const results = await this.processLoanNotifications(loans, "overdue");

      logger.info("Overdue payment check completed", {
        totalLoans: loans.length,
        notificationsSent: results.sent,
        errors: results.errors,
      });
    } catch (error) {
      logger.error("Error checking overdue payments", { error });
    }
  }

  private async checkUrgentPayments(): Promise<void> {
    try {
      logger.info("Checking urgent loan payments (due within 24 hours)");

      const loans = await this.getLoansWithUpcomingPayments(1); // 1 day ahead
      const results = await this.processLoanNotifications(loans, "urgent");

      logger.info("Urgent payment check completed", {
        totalLoans: loans.length,
        notificationsSent: results.sent,
        errors: results.errors,
      });
    } catch (error) {
      logger.error("Error checking urgent payments", { error });
    }
  }

  private async getLoansWithUpcomingPayments(daysAhead: number): Promise<LoanWithDueDate[]> {
    const queryText = `
      SELECT 
        loan_id,
        borrower,
        MAX(CASE WHEN event_type = 'LoanRequested' THEN amount END) as principal,
        MAX(CASE WHEN event_type = 'LoanApproved' THEN ledger_closed_at END) as approved_at,
        SUM(CASE WHEN event_type = 'LoanRepaid' THEN CAST(amount AS NUMERIC) ELSE 0 END) as total_repaid
      FROM loan_events
      WHERE loan_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM loan_events le2 
          WHERE le2.loan_id = loan_events.loan_id 
          AND le2.event_type = 'LoanApproved'
        )
      GROUP BY loan_id, borrower
      HAVING MAX(CASE WHEN event_type = 'LoanApproved' THEN 1 ELSE 0 END) = 1
    `;

    const result = await query(queryText);

    return result.rows
      .map((row) => {
        const principal = parseFloat(row.principal || "0");
        const totalRepaid = parseFloat(row.total_repaid || "0");
        const interestRate = 0.05; // 5% annual interest rate
        const daysElapsed = row.approved_at
          ? Math.floor((Date.now() - new Date(row.approved_at).getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        const accruedInterest = (principal * interestRate * daysElapsed) / 365;
        const totalOwed = principal + accruedInterest - totalRepaid;

        // Calculate next payment deadline (30 days from approval)
        const nextPaymentDeadline = new Date(
          new Date(row.approved_at).getTime() + 30 * 24 * 60 * 60 * 1000,
        );

        const daysUntilDue = Math.floor(
          (nextPaymentDeadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        );

        return {
          loanId: row.loan_id,
          borrower: row.borrower,
          principal,
          accruedInterest,
          totalRepaid,
          totalOwed,
          nextPaymentDeadline: nextPaymentDeadline.toISOString(),
          approvedAt: row.approved_at,
          daysUntilDue,
        };
      })
      .filter((loan) => loan.totalOwed > 0.01 && loan.daysUntilDue <= daysAhead && loan.daysUntilDue >= 0);
  }

  private async getOverdueLoans(): Promise<LoanWithDueDate[]> {
    const loans = await this.getLoansWithUpcomingPayments(0);
    
    return loans
      .map((loan) => {
        const daysOverdue = Math.abs(loan.daysUntilDue);
        return {
          ...loan,
          daysOverdue,
          daysUntilDue: -daysOverdue,
        };
      })
      .filter((loan) => loan.daysUntilDue < 0);
  }

  private async processLoanNotifications(
    loans: LoanWithDueDate[],
    type: "upcoming" | "overdue" | "urgent",
  ): Promise<{ sent: number; errors: number }> {
    let sent = 0;
    let errors = 0;

    for (const loan of loans) {
      try {
        const preferences = await this.getUserNotificationPreferences(loan.borrower);
        
        if (!preferences) {
          logger.warn("No notification preferences found for user", { borrower: loan.borrower });
          continue;
        }

        const notificationData = {
          loanId: loan.loanId,
          amountDue: loan.totalOwed.toFixed(2),
          dueDate: new Date(loan.nextPaymentDeadline).toLocaleDateString(),
          daysOverdue: loan.daysOverdue,
        };

        // Send email notification
        if (preferences.emailEnabled && preferences.email) {
          const emailData = {
            borrowerName: preferences.email.split("@")[0] || "Valued Customer",
            loanId: loan.loanId,
            amountDue: loan.totalOwed.toFixed(2),
            dueDate: new Date(loan.nextPaymentDeadline).toLocaleDateString(),
            totalOwed: loan.totalOwed.toFixed(2),
            daysOverdue: loan.daysOverdue || 0,
          };

          const emailSent = await emailService.sendRepaymentReminder(preferences.email, emailData);
          if (emailSent) sent++;
        }

        // Send SMS notification
        if (preferences.smsEnabled && preferences.phoneNumber) {
          const smsData = {
            loanId: loan.loanId,
            amountDue: loan.totalOwed.toFixed(2),
            dueDate: new Date(loan.nextPaymentDeadline).toLocaleDateString(),
            daysOverdue: loan.daysOverdue || 0,
          };

          const smsSent = await smsService.sendRepaymentReminderSms(preferences.phoneNumber, smsData);
          if (smsSent) sent++;
        }

        // Send WhatsApp notification
        if (preferences.whatsappEnabled && preferences.phoneNumber) {
          const whatsappData = {
            loanId: loan.loanId,
            amountDue: loan.totalOwed.toFixed(2),
            dueDate: new Date(loan.nextPaymentDeadline).toLocaleDateString(),
            daysOverdue: loan.daysOverdue || 0,
          };

          const whatsappSent = await whatsappService.sendRepaymentReminder(preferences.phoneNumber, whatsappData);
          if (whatsappSent) sent++;
        }

        // Log notification sent
        await this.logNotificationSent(loan.borrower, loan.loanId, type);

      } catch (error) {
        logger.error("Error processing loan notification", { 
          loanId: loan.loanId, 
          borrower: loan.borrower, 
          error 
        });
        errors++;
      }
    }

    return { sent, errors };
  }

  private async getUserNotificationPreferences(borrower: string): Promise<UserNotificationPreferences | null> {
    const queryText = `
      SELECT 
        email,
        phone_number,
        email_notifications_enabled,
        sms_notifications_enabled,
        whatsapp_notifications_enabled
      FROM user_profiles
      WHERE public_key = $1
    `;

    const result = await query(queryText, [borrower]);

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
  }

  private async logNotificationSent(borrower: string, loanId: string, type: string): Promise<void> {
    await query(
      `INSERT INTO notification_logs (borrower, loan_id, notification_type, sent_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
      [borrower, loanId, type],
    );
  }

  // Manual trigger for testing
  async triggerPaymentCheck(type: "upcoming" | "overdue" | "urgent"): Promise<void> {
    switch (type) {
      case "upcoming":
        await this.checkUpcomingPayments();
        break;
      case "overdue":
        await this.checkOverduePayments();
        break;
      case "urgent":
        await this.checkUrgentPayments();
        break;
    }
  }
}

export const notificationScheduler = new NotificationScheduler();
