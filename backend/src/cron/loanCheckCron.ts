import cron from 'node-cron';
import { query } from '../db/connection.js';
import { notificationService } from '../services/notificationService.js';
import { jobMetricsService } from '../services/jobMetricsService.js';
import logger from '../utils/logger.js';

let scheduledTask: cron.ScheduledTask | null = null;
let inFlight = false;

/**
 * Checks for loans that are due soon (e.g., within 24 hours) and notifies borrowers.
 * Runs every hour at the top of the hour.
 */
export function startLoanDueCheckCron() {
  if (scheduledTask) return;

  scheduledTask = cron.schedule('0 * * * *', async () => {
    if (inFlight) {
      logger
        .withContext()
        .warn('Loan due check cron skipped because a previous run is still in flight');
      return;
    }

    const startTime = Date.now();
    const jobName = 'loanDueCheckCron';
    inFlight = true;

    try {
      logger.withContext().info('Running loan due check cron...');

      // Find loans where a repayment is due in the next 24 hours
      // This is a simplified query; in a real app, you'd check against a repayment schedule table
      const result = await query(`
        SELECT le.loan_id, le.address, le.amount
        FROM contract_events le
        WHERE le.event_type = 'LoanApproved'
          AND NOT EXISTS (
            SELECT 1 FROM contract_events re 
            WHERE re.loan_id = le.loan_id AND re.event_type = 'LoanRepaid'
          )
          AND le.ledger_closed_at < NOW() - INTERVAL '30 days' -- Simplified due logic
      `);

      for (const loan of result.rows) {
        await notificationService.createNotification({
          userId: loan.address,
          type: 'repayment_due',
          title: 'Repayment Due Soon',
          message: `Your repayment for loan #${loan.loan_id} of ${loan.amount} is due.`,
          loanId: loan.loan_id,
        });
      }

      const durationMs = Date.now() - startTime;
      jobMetricsService.recordSuccess(jobName, durationMs);
      logger
        .withContext()
        .info(`Loan due check completed. Notified ${result.rows.length} borrowers.`);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      jobMetricsService.recordFailure(jobName, error as Error | string, durationMs);
      logger.withContext().error('Error in loan due check cron', { error });
    } finally {
      inFlight = false;
    }
  });
}

export function stopLoanDueCheckCron(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.withContext().info('Loan due check cron stopped');
  }
}
