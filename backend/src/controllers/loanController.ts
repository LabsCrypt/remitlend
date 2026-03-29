import type { Request, Response } from "express";
import { query } from "../db/connection.js";
import { AppError } from "../errors/AppError.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { sorobanService } from "../services/sorobanService.js";
import {
  createPaginatedResponse,
  getSortConfig,
  parseQueryParams,
} from "../utils/pagination.js";
import logger from "../utils/logger.js";

const LEDGER_CLOSE_SECONDS = 5;
const DEFAULT_TERM_LEDGERS = 17280; // 1 day in ledgers
const DEFAULT_INTEREST_RATE_BPS = 1200; // 12%
const DEFAULT_MIN_SCORE = 500;
const DEFAULT_MAX_AMOUNT = 50_000;
const DEFAULT_INTEREST_RATE_PERCENT = 12;
const LOAN_SORT_FIELDS = [
  "loanId",
  "principal",
  "accruedInterest",
  "totalRepaid",
  "totalOwed",
  "status",
  "approvedAt",
  "nextPaymentDeadline",
] as const;

const parsePositiveInteger = (
  value: string | undefined,
  fallback: number,
): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

type BorrowerLoan = {
  loanId: number;
  principal: number;
  accruedInterest: number;
  totalRepaid: number;
  totalOwed: number;
  nextPaymentDeadline: string;
  status: "active" | "repaid" | "defaulted";
  borrower: string;
  approvedAt: string | null;
};

const getLatestLedger = async (): Promise<number> => {
  const result = await query(
    "SELECT last_indexed_ledger FROM indexer_state ORDER BY id DESC LIMIT 1",
    [],
  );

  return result.rows[0]?.last_indexed_ledger ?? 0;
};

const compareLoanValues = (
  left: BorrowerLoan,
  right: BorrowerLoan,
  field: (typeof LOAN_SORT_FIELDS)[number],
  direction: "ASC" | "DESC",
) => {
  const leftValue = left[field];
  const rightValue = right[field];

  let comparison = 0;

  if (typeof leftValue === "number" && typeof rightValue === "number") {
    comparison = leftValue - rightValue;
  } else {
    const normalizedLeft = leftValue ?? "";
    const normalizedRight = rightValue ?? "";
    comparison = String(normalizedLeft).localeCompare(String(normalizedRight));
  }

  return direction === "DESC" ? comparison * -1 : comparison;
};

/**
 * Get active loans for a borrower
 *
 * GET /api/loans/borrower/:borrower
 */
export const getBorrowerLoans = asyncHandler(
  async (req: Request, res: Response) => {
    const { borrower } = req.params;
    const { limit, offset, sort, status, dateRange, amountRange } =
      parseQueryParams(req);

    const loansQuery = `
      SELECT
        loan_id,
        borrower,
        MAX(CASE WHEN event_type = 'LoanRequested' THEN amount END) as principal,
        MAX(CASE WHEN event_type = 'LoanApproved' THEN ledger_closed_at END) as approved_at,
        MAX(CASE WHEN event_type = 'LoanApproved' THEN ledger END) as approved_ledger,
        MAX(CASE WHEN event_type = 'LoanApproved' THEN interest_rate_bps END) as rate_bps,
        MAX(CASE WHEN event_type = 'LoanApproved' THEN term_ledgers END) as term_ledgers,
        COALESCE(SUM(CASE WHEN event_type = 'LoanRepaid' THEN CAST(amount AS NUMERIC) ELSE 0 END), 0) as total_repaid,
        MAX(CASE WHEN event_type = 'LoanDefaulted' THEN 1 ELSE 0 END) as is_defaulted
      FROM loan_events
      WHERE borrower = $1 AND loan_id IS NOT NULL
      GROUP BY loan_id, borrower
    `;

    const [result, currentLedger] = await Promise.all([
      query(loansQuery, [borrower]),
      getLatestLedger(),
    ]);

    const loans: BorrowerLoan[] = result.rows.map((row: any) => {
      const principal = Number.parseFloat(row.principal || "0");
      const totalRepaid = Number.parseFloat(row.total_repaid || "0");
      const rateBps = row.rate_bps || DEFAULT_INTEREST_RATE_BPS;
      const termLedgers = row.term_ledgers || DEFAULT_TERM_LEDGERS;
      const approvedLedger = row.approved_ledger || 0;
      const elapsedLedgers = Math.max(0, currentLedger - approvedLedger);
      const accruedInterest =
        (principal * rateBps * elapsedLedgers) / (10000 * termLedgers);
      const totalOwed = principal + accruedInterest - totalRepaid;
      const isActive = totalOwed > 0.01;
      const isDefaulted = Number.parseInt(row.is_defaulted || "0", 10) === 1;

      const nextPaymentDeadline = row.approved_at
        ? new Date(
            new Date(row.approved_at).getTime() +
              termLedgers * LEDGER_CLOSE_SECONDS * 1000,
          ).toISOString()
        : new Date().toISOString();

      return {
        loanId: Number(row.loan_id),
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

    let filteredLoans = loans;

    if (status && status !== "all") {
      filteredLoans = filteredLoans.filter((loan) => loan.status === status);
    }

    if (amountRange) {
      filteredLoans = filteredLoans.filter(
        (loan) =>
          loan.principal >= amountRange.min &&
          loan.principal <= amountRange.max,
      );
    }

    if (dateRange) {
      filteredLoans = filteredLoans.filter((loan) => {
        if (!loan.approvedAt) {
          return false;
        }

        const approvedAt = new Date(loan.approvedAt);
        return approvedAt >= dateRange.start && approvedAt <= dateRange.end;
      });
    }

    const sortConfig = getSortConfig(
      sort,
      LOAN_SORT_FIELDS,
      "approvedAt",
      "DESC",
    );

    const sortedLoans = [...filteredLoans].sort((left, right) =>
      compareLoanValues(
        left,
        right,
        sortConfig.field as (typeof LOAN_SORT_FIELDS)[number],
        sortConfig.direction,
      ),
    );

    const paginatedLoans = sortedLoans.slice(offset, offset + limit);

    res.json(
      createPaginatedResponse(
        {
          borrower,
          loans: paginatedLoans,
        },
        sortedLoans.length,
        limit,
        offset,
        paginatedLoans.length,
      ),
    );
  },
);

/**
 * GET /api/loans/config
 */
export const getLoanConfig = asyncHandler(
  async (_req: Request, res: Response) => {
    const minScore = parsePositiveInteger(
      process.env.LOAN_MIN_SCORE,
      DEFAULT_MIN_SCORE,
    );
    const maxAmount = parsePositiveInteger(
      process.env.LOAN_MAX_AMOUNT,
      DEFAULT_MAX_AMOUNT,
    );
    const interestRatePercent = parsePositiveInteger(
      process.env.LOAN_INTEREST_RATE_PERCENT,
      DEFAULT_INTEREST_RATE_PERCENT,
    );

    res.json({
      success: true,
      data: {
        minScore,
        maxAmount,
        interestRatePercent,
      },
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
      (event: any) => event.event_type === "LoanRequested",
    );
    const approvalEvent = events.find(
      (event: any) => event.event_type === "LoanApproved",
    );
    const repaymentEvents = events.filter(
      (event: any) => event.event_type === "LoanRepaid",
    );

    const principal = Number.parseFloat(requestEvent?.amount || "0");
    const totalRepaid = repaymentEvents.reduce(
      (sum: number, event: any) => sum + Number.parseFloat(event.amount || "0"),
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
      (event: any) => event.event_type === "LoanDefaulted",
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
        events: events.map((event: any) => ({
          type: event.event_type,
          amount: event.amount,
          timestamp: event.ledger_closed_at,
          tx: event.tx_hash,
        })),
      },
    });
  },
);

/**
 * POST /api/loans/request
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

  if (borrowerPublicKey !== req.user?.publicKey) {
    throw AppError.forbidden(
      "borrowerPublicKey must match your authenticated wallet",
    );
  }

  const loanIdNum = Number.parseInt(loanId, 10);
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
