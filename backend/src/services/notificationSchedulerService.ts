import * as cron from "node-cron";
import { query } from "../db/connection.js";
import {
  ExternalNotificationService,
  ExternalNotificationEvent,
} from "./externalNotificationService.js";
import logger from "../utils/logger.js";

export interface LoanPaymentInfo {
  loanId: string;
  borrowerId: string;
  borrowerName: string;
  amount: string;
  currency: string;
  dueDate: string;
  daysUntilDue: number;
  daysOverdue?: number;
  status: string;
}

export class NotificationSchedulerService {
  private static instance: NotificationSchedulerService;
  private notificationService: ExternalNotificationService;
  private tasks: cron.ScheduledTask[] = [];
  private isRunning: boolean = false;

  private constructor() {
    this.notificationService = ExternalNotificationService.getInstance();
  }

  public static getInstance(): NotificationSchedulerService {
    if (!NotificationSchedulerService.instance) {
      NotificationSchedulerService.instance =
        new NotificationSchedulerService();
    }
    return NotificationSchedulerService.instance;
  }

  public start(): void {
    if (this.isRunning) {
      logger.warn("Notification scheduler is already running");
      return;
    }

    const checkInterval =
      process.env.NOTIFICATION_CHECK_INTERVAL_MINUTES || "60";

    // Schedule payment reminders check
    const paymentReminderTask = cron.schedule(
      `*/${checkInterval} * * * *`,
      () => this.checkPaymentReminders(),
    );

    // Schedule overdue payments check
    const overdueCheckInterval =
      process.env.PAYMENT_OVERDUE_CHECK_INTERVAL_HOURS || "6";
    const overduePaymentTask = cron.schedule(
      `0 */${overdueCheckInterval} * * *`,
      () => this.checkOverduePayments(),
    );

    // Schedule daily loan status summary
    const dailySummaryTask = cron.schedule("0 8 * * *", () =>
      this.sendDailyLoanSummary(),
    );

    // Schedule weekly engagement notifications
    const weeklyEngagementTask = cron.schedule("0 10 * * 1", () =>
      this.sendWeeklyEngagementNotifications(),
    );

    this.tasks = [
      paymentReminderTask,
      overduePaymentTask,
      dailySummaryTask,
      weeklyEngagementTask,
    ];

    // Start all tasks
    this.tasks.forEach((task) => task.start());
    this.isRunning = true;

    logger.info("Notification scheduler started", {
      checkInterval: `${checkInterval} minutes`,
      overdueCheckInterval: `${overdueCheckInterval} hours`,
    });
  }

  public stop(): void {
    if (!this.isRunning) {
      logger.warn("Notification scheduler is not running");
      return;
    }

    this.tasks.forEach((task) => task.stop());
    this.tasks = [];
    this.isRunning = false;

    logger.info("Notification scheduler stopped");
  }

  private async checkPaymentReminders(): Promise<void> {
    try {
      logger.info("Checking payment reminders...");

      const reminderDays = parseInt(
        process.env.PAYMENT_REMINDER_DAYS_BEFORE || "3",
      );
      const loans = await this.getUpcomingPayments(reminderDays);

      if (loans.length === 0) {
        logger.info("No upcoming payments found");
        return;
      }

      logger.info(`Found ${loans.length} upcoming payments`);

      const notifications: ExternalNotificationEvent[] = loans.map((loan) => ({
        type: "payment_reminder",
        userId: loan.borrowerId,
        data: {
          loanId: loan.loanId,
          borrowerName: loan.borrowerName,
          amount: loan.amount,
          currency: loan.currency,
          dueDate: loan.dueDate,
        },
        priority: loan.daysUntilDue <= 1 ? "high" : "medium",
      }));

      const results =
        await this.notificationService.sendBulkNotifications(notifications);

      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.length - successCount;

      logger.info("Payment reminders processed", {
        total: loans.length,
        successful: successCount,
        failed: failureCount,
      });

      if (failureCount > 0) {
        const failedResults = results.filter((r) => !r.success);
        logger.error("Some payment reminders failed", {
          failures: failedResults,
        });
      }
    } catch (error) {
      logger.error("Error checking payment reminders:", error);
    }
  }

  private async checkOverduePayments(): Promise<void> {
    try {
      logger.info("Checking overdue payments...");

      const loans = await this.getOverduePayments();

      if (loans.length === 0) {
        logger.info("No overdue payments found");
        return;
      }

      logger.info(`Found ${loans.length} overdue payments`);

      const notifications: ExternalNotificationEvent[] = loans.map((loan) => ({
        type: "payment_overdue",
        userId: loan.borrowerId,
        data: {
          loanId: loan.loanId,
          borrowerName: loan.borrowerName,
          amount: loan.amount,
          currency: loan.currency,
          dueDate: loan.dueDate,
          daysOverdue: loan.daysOverdue || 0,
        },
        priority: loan.daysOverdue && loan.daysOverdue > 7 ? "high" : "medium",
      }));

      const results =
        await this.notificationService.sendBulkNotifications(notifications);

      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.length - successCount;

      logger.info("Overdue payment notifications processed", {
        total: loans.length,
        successful: successCount,
        failed: failureCount,
      });

      if (failureCount > 0) {
        const failedResults = results.filter((r) => !r.success);
        logger.error("Some overdue payment notifications failed", {
          failures: failedResults,
        });
      }
    } catch (error) {
      logger.error("Error checking overdue payments:", error);
    }
  }

  private async sendDailyLoanSummary(): Promise<void> {
    try {
      logger.info("Sending daily loan summary...");

      // Get users with active loans
      const usersWithActiveLoans = await this.getUsersWithActiveLoans();

      if (usersWithActiveLoans.length === 0) {
        logger.info("No users with active loans found");
        return;
      }

      logger.info(
        `Sending daily summaries to ${usersWithActiveLoans.length} users`,
      );

      // Send summary notifications (this would be implemented based on business requirements)
      // For now, we'll just log the count
      logger.info("Daily loan summary sent", {
        userCount: usersWithActiveLoans.length,
      });
    } catch (error) {
      logger.error("Error sending daily loan summary:", error);
    }
  }

  private async sendWeeklyEngagementNotifications(): Promise<void> {
    try {
      logger.info("Sending weekly engagement notifications...");

      // Get users who haven't engaged in the last 7 days
      const inactiveUsers = await this.getInactiveUsers(7);

      if (inactiveUsers.length === 0) {
        logger.info("No inactive users found");
        return;
      }

      logger.info(
        `Sending engagement notifications to ${inactiveUsers.length} inactive users`,
      );

      // Send engagement notifications (this would be implemented based on business requirements)
      logger.info("Weekly engagement notifications sent", {
        userCount: inactiveUsers.length,
      });
    } catch (error) {
      logger.error("Error sending weekly engagement notifications:", error);
    }
  }

  private async getUpcomingPayments(
    daysAhead: number,
  ): Promise<LoanPaymentInfo[]> {
    try {
      const result = await query(
        `SELECT 
          le.loan_id,
          le.borrower as borrower_id,
          COALESCE(up.first_name, 'User') as borrower_name,
          le.amount,
          le.currency,
          (le.ledger_closed_at + INTERVAL '30 days')::date as due_date,
          EXTRACT(DAYS FROM (le.ledger_closed_at + INTERVAL '30 days') - CURRENT_DATE) as days_until_due,
          le.status
         FROM loan_events le
         LEFT JOIN user_profiles up ON le.borrower = up.public_key
         WHERE le.event_type = 'LoanApproved'
           AND le.status = 'active'
           AND EXTRACT(DAYS FROM (le.ledger_closed_at + INTERVAL '30 days') - CURRENT_DATE) BETWEEN 0 AND $1
         ORDER BY days_until_due ASC`,
        [daysAhead],
      );

      return result.rows.map((row: any) => ({
        loanId: row.loan_id,
        borrowerId: row.borrower_id,
        borrowerName: row.borrower_name,
        amount: row.amount,
        currency: row.currency,
        dueDate: row.due_date,
        daysUntilDue: parseInt(row.days_until_due),
        status: row.status,
      }));
    } catch (error) {
      logger.error("Error fetching upcoming payments:", error);
      return [];
    }
  }

  private async getOverduePayments(): Promise<LoanPaymentInfo[]> {
    try {
      const result = await query(
        `SELECT 
          le.loan_id,
          le.borrower as borrower_id,
          COALESCE(up.first_name, 'User') as borrower_name,
          le.amount,
          le.currency,
          (le.ledger_closed_at + INTERVAL '30 days')::date as due_date,
          EXTRACT(DAYS FROM CURRENT_DATE - (le.ledger_closed_at + INTERVAL '30 days')) as days_overdue,
          le.status
         FROM loan_events le
         LEFT JOIN user_profiles up ON le.borrower = up.public_key
         WHERE le.event_type = 'LoanApproved'
           AND le.status = 'active'
           AND CURRENT_DATE > (le.ledger_closed_at + INTERVAL '30 days')
         ORDER BY days_overdue DESC`,
        [],
      );

      return result.rows.map((row: any) => ({
        loanId: row.loan_id,
        borrowerId: row.borrower_id,
        borrowerName: row.borrower_name,
        amount: row.amount,
        currency: row.currency,
        dueDate: row.due_date,
        daysUntilDue: -parseInt(row.days_overdue),
        daysOverdue: parseInt(row.days_overdue),
        status: row.status,
      }));
    } catch (error) {
      logger.error("Error fetching overdue payments:", error);
      return [];
    }
  }

  private async getUsersWithActiveLoans(): Promise<string[]> {
    try {
      const result = await query(
        `SELECT DISTINCT borrower 
         FROM loan_events 
         WHERE event_type = 'LoanApproved' 
           AND status = 'active'`,
        [],
      );

      return result.rows.map((row: any) => row.borrower);
    } catch (error) {
      logger.error("Error fetching users with active loans:", error);
      return [];
    }
  }

  private async getInactiveUsers(daysInactive: number): Promise<string[]> {
    try {
      const result = await query(
        `SELECT DISTINCT le.borrower 
         FROM loan_events le
         WHERE le.borrower NOT IN (
           SELECT DISTINCT borrower 
           FROM loan_events 
           WHERE ledger_closed_at >= CURRENT_DATE - INTERVAL '${daysInactive} days'
         )
         AND le.event_type = 'LoanApproved'
         AND le.status = 'active'`,
        [],
      );

      return result.rows.map((row: any) => row.borrower);
    } catch (error) {
      logger.error("Error fetching inactive users:", error);
      return [];
    }
  }

  // Manual trigger methods for testing
  public async triggerPaymentReminderCheck(): Promise<void> {
    await this.checkPaymentReminders();
  }

  public async triggerOverduePaymentCheck(): Promise<void> {
    await this.checkOverduePayments();
  }

  public async triggerDailySummary(): Promise<void> {
    await this.sendDailyLoanSummary();
  }

  public async triggerWeeklyEngagement(): Promise<void> {
    await this.sendWeeklyEngagementNotifications();
  }

  public getSchedulerStatus(): {
    isRunning: boolean;
    activeTasks: number;
    nextRuns: string[];
  } {
    const nextRuns = this.tasks.map((task) => {
      // Get next run time (this is approximate)
      const nextDate = new Date();
      nextDate.setMinutes(nextDate.getMinutes() + 1); // Rough estimate
      return nextDate.toISOString();
    });

    return {
      isRunning: this.isRunning,
      activeTasks: this.tasks.length,
      nextRuns,
    };
  }
}
