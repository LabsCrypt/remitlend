import cron from "node-cron";
import { query } from "../db/connection.js";
import { notificationService } from "../services/notificationService.js";
import logger from "../utils/logger.js";

/**
 * Checks for loans that are due soon (e.g., within 24 hours) and notifies borrowers.
 * Runs every hour at the top of the hour.
 */
export function startLoanDueCheckCron() {
  cron.schedule("0 * * * *", async () => {
    logger.info("Running loan due check cron...");

    try {
      // Find loans where a repayment is due in the next 24 hours
      // This is a simplified query; in a real app, you'd check against a repayment schedule table
      const result = await query(`
        SELECT le.loan_id, le.borrower, le.amount
        FROM loan_events le
        WHERE le.event_type = 'LoanApproved'
          AND NOT EXISTS (
            SELECT 1 FROM loan_events re 
            WHERE re.loan_id = le.loan_id AND re.event_type = 'LoanRepaid'
          )
          AND le.ledger_closed_at < NOW() - INTERVAL '30 days' -- Simplified due logic
      `);

      for (const loan of result.rows) {
        await notificationService.createNotification({
          userId: loan.borrower,
          type: "repayment_due",
          title: "Repayment Due Soon",
          message: `Your repayment for loan #${loan.loan_id} of ${loan.amount} is due.`,
          loanId: loan.loan_id,
        });
      }
      
      logger.info(`Loan due check completed. Notified ${result.rows.length} borrowers.`);
    } catch (error) {
      logger.error("Error in loan due check cron", { error });
    }
  });
}
