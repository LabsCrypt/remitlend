import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { query } from "../db/connection.js";
import logger from "../utils/logger.js";
import { AppError } from "../errors/AppError.js";
import { sorobanService } from "../services/sorobanService.js";

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
 *
 * GET /api/loans/borrower/:borrower
 */
export const getBorrowerLoans = asyncHandler(
  async (req: Request, res: Response) => {
    const { borrower } = req.params;
    const { status = "all" } = req.query;

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
        loanId: row.loan_id,
        principal,
        accruedInterest,
        totalRepaid,
        totalOwed,
        nextPaymentDeadline,
        status: isDefaulted ? "defaulted" : isActive ? "active" : "repaid",
        borrower: row.borrower,
        approvedAt: row.approved_at,
      };
    });

    // Filter by status if specified
    const filteredLoans =
      status === "all"
        ? loans
        : loans.filter((loan: any) => loan.status === status);

    res.json({
      success: true,
      borrower,
      loans: filteredLoans,
    });
  },
);

/**
 * Get detailed loan history and current stats
 *
 * GET /api/loans/:loanId
 */
export const getLoanDetails = asyncHandler(
  async (req: Request, res: Response) => {
    const { loanId } = req.params;

    // Fetch all events for this loan
    const eventsResult = await query(
      `SELECT event_type, amount, ledger, ledger_closed_at, tx_hash, interest_rate_bps, term_ledgers
       FROM loan_events
       WHERE loan_id = $1
       ORDER BY ledger_closed_at ASC`,
      [loanId],
    );

    if (eventsResult.rows.length === 0) {
      res.status(404).json({ success: false, message: "Loan not found" });
      return;
    }

    const events = eventsResult.rows;
    const currentLedger = await getLatestLedger();

    const requestEvent = events.find(
      (e: any) => e.event_type === "LoanRequested",
    );
    const approvalEvent = events.find(
      (e: any) => e.event_type === "LoanApproved",
    );
    const repaymentEvents = events.filter(
      (e: any) => e.event_type === "LoanRepaid",
    );

    const principal = parseFloat(requestEvent?.amount || "0");
    const totalRepaid = repaymentEvents.reduce(
      (sum: number, e: any) => sum + parseFloat(e.amount || "0"),
      0,
    );

    const rateBps =
      approvalEvent?.interest_rate_bps || DEFAULT_INTEREST_RATE_BPS;
    const termLedgers = approvalEvent?.term_ledgers || DEFAULT_TERM_LEDGERS;
    const approvedLedger = approvalEvent?.ledger || 0;

    const elapsedLedgers = Math.max(0, currentLedger - approvedLedger);
    const accruedInterest =
      (principal * rateBps * elapsedLedgers) / (10000 * termLedgers);

    const totalOwed = principal + accruedInterest - totalRepaid;
    const isDefaulted = events.some(
      (e: any) => e.event_type === "LoanDefaulted",
    );

    res.json({
      success: true,
      loanId,
      summary: {
        principal,
        accruedInterest,
        totalRepaid,
        totalOwed,
        interestRate: rateBps / 10000,
        termLedgers,
        elapsedLedgers,
        status: isDefaulted
          ? "defaulted"
          : totalOwed > 0.01
            ? "active"
            : "repaid",
        requestedAt: requestEvent?.ledger_closed_at,
        approvedAt: approvalEvent?.ledger_closed_at,
        events: events.map((e: any) => ({
          type: e.event_type,
          amount: e.amount,
          timestamp: e.ledger_closed_at,
          tx: e.tx_hash,
        })),
      },
    });
  },
);

/**
 * POST /api/loans/request
 *
 * Builds an unsigned Soroban request_loan(borrower, amount) transaction XDR.
 * The frontend signs it with the user's wallet and submits via POST /api/loans/submit.
 *
 * Body: { amount: number, borrowerPublicKey: string }
 */
export const requestLoan = asyncHandler(async (req: Request, res: Response) => {
  const { amount, borrowerPublicKey } = req.body as {
    amount: number;
    borrowerPublicKey: string;
  };

  if (!borrowerPublicKey || !amount || amount <= 0) {
    throw AppError.badRequest(
      "borrowerPublicKey and a positive amount are required",
    );
  }

  // Ensure the borrowerPublicKey matches the authenticated wallet
  if (borrowerPublicKey !== req.user?.publicKey) {
    throw AppError.forbidden(
      "borrowerPublicKey must match your authenticated wallet",
    );
  }

  const result = await sorobanService.buildRequestLoanTx(
    borrowerPublicKey,
    amount,
  );

  logger.info("Loan request transaction built", {
    borrower: borrowerPublicKey,
    amount,
  });

  res.json({
    success: true,
    unsignedTxXdr: result.unsignedTxXdr,
    networkPassphrase: result.networkPassphrase,
  });
});

/**
 * POST /api/loans/:loanId/repay
 *
 * Builds an unsigned Soroban repay(borrower, loan_id, amount) transaction XDR.
 * The frontend signs it with the user's wallet and submits via
 * POST /api/loans/:loanId/submit.
 *
 * Body: { amount: number, borrowerPublicKey: string }
 */
export const repayLoan = asyncHandler(async (req: Request, res: Response) => {
  const loanId = req.params.loanId as string;
  const { amount, borrowerPublicKey } = req.body as {
    amount: number;
    borrowerPublicKey: string;
  };

  if (!borrowerPublicKey || !amount || amount <= 0) {
    throw AppError.badRequest(
      "borrowerPublicKey and a positive amount are required",
    );
  }

  // Ensure the borrowerPublicKey matches the authenticated wallet
  if (borrowerPublicKey !== req.user?.publicKey) {
    throw AppError.forbidden(
      "borrowerPublicKey must match your authenticated wallet",
    );
  }

  const loanIdNum = parseInt(loanId, 10);
  if (!Number.isFinite(loanIdNum) || loanIdNum <= 0) {
    throw AppError.badRequest("Invalid loan ID");
  }

  const result = await sorobanService.buildRepayTx(
    borrowerPublicKey,
    loanIdNum,
    amount,
  );

  logger.info("Repay transaction built", {
    borrower: borrowerPublicKey,
    loanId: loanIdNum,
    amount,
  });

  res.json({
    success: true,
    loanId: loanIdNum,
    unsignedTxXdr: result.unsignedTxXdr,
    networkPassphrase: result.networkPassphrase,
  });
});

/**
 * POST /api/loans/submit
 * POST /api/loans/:loanId/submit
 *
 * Submits a signed transaction XDR to the Stellar network.
 *
 * Body: { signedTxXdr: string }
 */
export const submitTransaction = asyncHandler(
  async (req: Request, res: Response) => {
    const { signedTxXdr } = req.body as { signedTxXdr: string };

    if (!signedTxXdr) {
      throw AppError.badRequest("signedTxXdr is required");
    }

    const result = await sorobanService.submitSignedTx(signedTxXdr);

    logger.info("Transaction submitted", {
      txHash: result.txHash,
      status: result.status,
    });

    res.json({
      success: true,
      txHash: result.txHash,
      status: result.status,
      ...(result.resultXdr ? { resultXdr: result.resultXdr } : {}),
    });
  },
);
