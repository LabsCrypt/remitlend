import { Request, Response } from "express";
import { query } from "../db/connection.js";
import logger from "../utils/logger.js";
 
 const LEDGER_CLOSE_SECONDS = 5;
 const DEFAULT_TERM_LEDGERS = 17280; // 1 day in ledgers
 const DEFAULT_INTEREST_RATE_BPS = 1200; // 12%
 
 const getLatestLedger = async (): Promise<number> => {
   const result = await query(
     "SELECT last_indexed_ledger FROM indexer_state ORDER BY id DESC LIMIT 1",
     [],
   );
   return result.rows[0]?.last_indexed_ledger ?? 0;
 };

/**
 * Get active loans for a borrower
 */
export const getBorrowerLoans = async (req: Request, res: Response) => {
  try {
    const { borrower } = req.params;
    const { status = "active" } = req.query;

    if (!borrower) {
      return res.status(400).json({
        success: false,
        message: "Borrower address is required",
      });
    }

    // Fetch loans from loan_events table
    const loansQuery = `
      SELECT 
        loan_id,
        borrower,
        MAX(CASE WHEN event_type = 'LoanRequested' THEN amount END) as principal,
        MAX(CASE WHEN event_type = 'LoanApproved' THEN ledger_closed_at END) as approved_at,
        MAX(CASE WHEN event_type = 'LoanApproved' THEN ledger END) as approved_ledger,
        MAX(CASE WHEN event_type = 'LoanApproved' THEN interest_rate_bps END) as rate_bps,
        MAX(CASE WHEN event_type = 'LoanApproved' THEN term_ledgers END) as term_ledgers,
        SUM(CASE WHEN event_type = 'LoanRepaid' THEN CAST(amount AS NUMERIC) ELSE 0 END) as total_repaid,
        MAX(CASE WHEN event_type = 'LoanDefaulted' THEN 1 ELSE 0 END) as is_defaulted
      FROM loan_events
      WHERE borrower = $1 AND loan_id IS NOT NULL
      GROUP BY loan_id, borrower
      HAVING MAX(CASE WHEN event_type = 'LoanApproved' THEN 1 ELSE 0 END) = 1
    `;

    const result = await query(loansQuery, [borrower]);
    const currentLedger = await getLatestLedger();

    const loans = result.rows.map((row: any) => {
      const principal = parseFloat(row.principal || "0");
      const totalRepaid = parseFloat(row.total_repaid || "0");

      const rateBps = row.rate_bps || DEFAULT_INTEREST_RATE_BPS;
      const termLedgers = row.term_ledgers || DEFAULT_TERM_LEDGERS;
      const approvedLedger = row.approved_ledger || 0;

      const elapsedLedgers = Math.max(0, currentLedger - approvedLedger);
      const accruedInterest =
        (principal * rateBps * elapsedLedgers) / (10000 * termLedgers);

      const totalOwed = principal + accruedInterest - totalRepaid;
      const isActive = totalOwed > 0.01;
      const isDefaulted = parseInt(row.is_defaulted || "0", 10) === 1;

      // Calculate next payment deadline using approximate calendar time for display
      const nextPaymentDeadline = row.approved_at
        ? new Date(
            new Date(row.approved_at).getTime() +
              termLedgers * LEDGER_CLOSE_SECONDS * 1000,
          ).toISOString()
        : new Date().toISOString();

      return {
        id: row.loan_id,
        principal,
        accruedInterest,
        totalRepaid,
        totalOwed,
        nextPaymentDeadline,
        status: isDefaulted ? "defaulted" : (isActive ? "active" : "repaid"),
        borrower: row.borrower,
        approvedAt: row.approved_at,
      };
    });

    // Filter by status if specified
    const filteredLoans =
      status === "all" ? loans : loans.filter((loan: any) => loan.status === status);

    res.json({
      success: true,
      data: {
        borrower,
        loans: filteredLoans,
        totalLoans: filteredLoans.length,
      },
    });
  } catch (error) {
    logger.error("Failed to get borrower loans", { error });
    res.status(500).json({
      success: false,
      message: "Failed to fetch loans",
    });
  }
};

/**
 * Get loan details by ID
 */
export const getLoanDetails = async (req: Request, res: Response) => {
  try {
    const { loanId } = req.params;

    if (!loanId) {
      return res.status(400).json({
        success: false,
        message: "Loan ID is required",
      });
    }

    // Fetch all events for this loan
    const eventsResult = await query(
      `SELECT event_type, amount, ledger, ledger_closed_at, tx_hash, interest_rate_bps, term_ledgers
       FROM loan_events
       WHERE loan_id = $1
       ORDER BY ledger_closed_at ASC`,
      [loanId],
    );

    if (eventsResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Loan not found",
      });
    }

    const events = eventsResult.rows;
    const currentLedger = await getLatestLedger();

    const requestEvent = events.find((e: any) => e.event_type === "LoanRequested");
    const approvalEvent = events.find((e: any) => e.event_type === "LoanApproved");
    const repaymentEvents = events.filter((e: any) => e.event_type === "LoanRepaid");

    const principal = parseFloat(requestEvent?.amount || "0");
    const totalRepaid = repaymentEvents.reduce(
      (sum: number, e: any) => sum + parseFloat(e.amount || "0"),
      0,
    );

    const rateBps = approvalEvent?.interest_rate_bps || DEFAULT_INTEREST_RATE_BPS;
    const termLedgers = approvalEvent?.term_ledgers || DEFAULT_TERM_LEDGERS;
    const approvedLedger = approvalEvent?.ledger || 0;

    const elapsedLedgers = Math.max(0, currentLedger - approvedLedger);
    const accruedInterest =
      (principal * rateBps * elapsedLedgers) / (10000 * termLedgers);

    const totalOwed = principal + accruedInterest - totalRepaid;
    const isDefaulted = events.some((e: any) => e.event_type === "LoanDefaulted");

    res.json({
      success: true,
      data: {
        loanId: parseInt(loanId as string),
        principal,
        accruedInterest,
        totalRepaid,
        totalOwed,
        interestRate: rateBps / 10000,
        termLedgers,
        elapsedLedgers,
        status: isDefaulted ? "defaulted" : (totalOwed > 0.01 ? "active" : "repaid"),
        requestedAt: requestEvent?.ledger_closed_at,
        approvedAt: approvalEvent?.ledger_closed_at,
        events: events.map((e: any) => ({
          type: e.event_type,
          amount: e.amount,
          timestamp: e.ledger_closed_at,
          txHash: e.tx_hash,
        })),
      },
    });
  } catch (error) {
    logger.error("Failed to get loan details", { error });
    res.status(500).json({
      success: false,
      message: "Failed to fetch loan details",
    });
  }
};
