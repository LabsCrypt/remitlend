import { Request, Response } from "express";
import { query } from "../db/connection.js";
import logger from "../utils/logger.js";
import { parseQueryParams, createPaginatedResponse } from "../utils/pagination.js";

/**
 * Get active loans for a borrower
 */
export const getBorrowerLoans = async (req: Request, res: Response) => {
  try {
    const { borrower } = req.params;
    const { limit, offset, sort, status, dateRange, amountRange } = parseQueryParams(req);

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
        SUM(CASE WHEN event_type = 'LoanRepaid' THEN CAST(amount AS NUMERIC) ELSE 0 END) as total_repaid
      FROM loan_events
      WHERE borrower = $1 AND loan_id IS NOT NULL
      GROUP BY loan_id, borrower
      HAVING MAX(CASE WHEN event_type = 'LoanApproved' THEN 1 ELSE 0 END) = 1
    `;

    const result = await query(loansQuery, [borrower]);

    const loans = result.rows.map((row) => {
      const principal = parseFloat(row.principal || "0");
      const totalRepaid = parseFloat(row.total_repaid || "0");
      const interestRate = 0.05; // 5% annual interest rate
      const daysElapsed = row.approved_at
        ? Math.floor(
            (Date.now() - new Date(row.approved_at).getTime()) /
              (1000 * 60 * 60 * 24),
          )
        : 0;
      const accruedInterest = (principal * interestRate * daysElapsed) / 365;
      const totalOwed = principal + accruedInterest - totalRepaid;
      const isActive = totalOwed > 0.01;

      // Calculate next payment deadline (30 days from approval)
      const nextPaymentDeadline = row.approved_at
        ? new Date(
            new Date(row.approved_at).getTime() + 30 * 24 * 60 * 60 * 1000,
          ).toISOString()
        : new Date().toISOString();

      return {
        id: row.loan_id,
        principal,
        accruedInterest,
        totalRepaid,
        totalOwed,
        nextPaymentDeadline,
        status: isActive ? "active" : "repaid",
        borrower: row.borrower,
        approvedAt: row.approved_at,
      };
    });

    // Filter by status if specified
    let filteredLoans = loans;
    if (status && status !== "all") {
      filteredLoans = filteredLoans.filter((loan) => loan.status === status);
    }
    if (amountRange) {
      filteredLoans = filteredLoans.filter(
        (loan) => loan.principal >= amountRange.min && loan.principal <= amountRange.max
      );
    }
    if (dateRange) {
      filteredLoans = filteredLoans.filter((loan) => {
        if (!loan.approvedAt) return false;
        const d = new Date(loan.approvedAt);
        return d >= dateRange.start && d <= dateRange.end;
      });
    }

    // Sorting
    if (sort) {
      const isDesc = sort.startsWith("-");
      const sortField = sort.replace(/^-/, "");
      filteredLoans.sort((a, b) => {
        let valA = (a as any)[sortField];
        let valB = (b as any)[sortField];
        if (typeof valA === "string") valA = valA.toLowerCase();
        if (typeof valB === "string") valB = valB.toLowerCase();
        
        if (valA < valB) return isDesc ? 1 : -1;
        if (valA > valB) return isDesc ? -1 : 1;
        return 0;
      });
    }

    // Pagination
    const totalLoans = filteredLoans.length;
    const paginatedLoans = filteredLoans.slice(offset, offset + limit);

    res.json(createPaginatedResponse({
      borrower,
      loans: paginatedLoans,
    }, totalLoans, limit, offset));
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
      `SELECT event_type, amount, ledger_closed_at, tx_hash
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
    const requestEvent = events.find((e) => e.event_type === "LoanRequested");
    const approvalEvent = events.find((e) => e.event_type === "LoanApproved");
    const repaymentEvents = events.filter((e) => e.event_type === "LoanRepaid");

    const principal = parseFloat(requestEvent?.amount || "0");
    const totalRepaid = repaymentEvents.reduce(
      (sum, e) => sum + parseFloat(e.amount || "0"),
      0,
    );

    const interestRate = 0.05;
    const daysElapsed = approvalEvent
      ? Math.floor(
          (Date.now() - new Date(approvalEvent.ledger_closed_at).getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : 0;
    const accruedInterest = (principal * interestRate * daysElapsed) / 365;
    const totalOwed = principal + accruedInterest - totalRepaid;

    res.json({
      success: true,
      data: {
        loanId: parseInt(loanId as string),
        principal,
        accruedInterest,
        totalRepaid,
        totalOwed,
        interestRate,
        status: totalOwed > 0.01 ? "active" : "repaid",
        requestedAt: requestEvent?.ledger_closed_at,
        approvedAt: approvalEvent?.ledger_closed_at,
        events: events.map((e) => ({
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
