import type { Request, Response } from "express";
import { query } from "../db/connection.js";
import { AppError } from "../errors/AppError.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { getLoanConfig } from "../config/loanConfig.js";
import { ErrorCode } from "../errors/errorCodes.js";
import { sorobanService } from "../services/sorobanService.js";
import {
  createCursorPaginatedResponse,
  parseCursorQueryParams,
} from "../utils/pagination.js";
import logger from "../utils/logger.js";

const LEDGER_CLOSE_SECONDS = 5;
const DEFAULT_TERM_LEDGERS = 17280; // 1 day in ledgers
const DEFAULT_INTEREST_RATE_BPS = 1200; // 12%

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

/**
 * Get active loans for a borrower
 *
 * GET /api/loans/borrower/:borrower
 */
export const getBorrowerLoans = asyncHandler(
  async (req: Request, res: Response) => {
    const { borrower } = req.params;
    const { limit, cursor, sort, status, dateRange, amountRange } =
      parseCursorQueryParams(req);


    const currentLedger = await getLatestLedger();

    const loansQuery = `
      WITH loan_summaries AS (
        SELECT
          loan_id,
          borrower,
          MAX(CASE WHEN event_type = 'LoanRequested' THEN amount END)::numeric as principal,
          MAX(CASE WHEN event_type = 'LoanApproved' THEN ledger_closed_at END) as approved_at,
          MAX(CASE WHEN event_type = 'LoanApproved' THEN ledger END) as approved_ledger,
          MAX(CASE WHEN event_type = 'LoanApproved' THEN interest_rate_bps END) as rate_bps,
          MAX(CASE WHEN event_type = 'LoanApproved' THEN term_ledgers END) as term_ledgers,
          SUM(CASE WHEN event_type = 'LoanRepaid' THEN amount::numeric ELSE 0 END) as total_repaid,
          MAX(CASE WHEN event_type = 'LoanDefaulted' THEN 1 ELSE 0 END) as is_defaulted
        FROM loan_events
        WHERE borrower = $1 AND loan_id IS NOT NULL
        GROUP BY loan_id, borrower
      ),
      loan_calculations AS (
        SELECT
          *,
          COALESCE(rate_bps, ${DEFAULT_INTEREST_RATE_BPS}) as effective_rate_bps,
          COALESCE(term_ledgers, ${DEFAULT_TERM_LEDGERS}) as effective_term_ledgers,
          COALESCE(approved_ledger, 0) as effective_approved_ledger
        FROM loan_summaries
      ),
      loan_fin AS (
        SELECT
          *,
          (principal * effective_rate_bps * GREATEST(0, $2 - effective_approved_ledger)) / (10000 * effective_term_ledgers) as accrued_interest
        FROM loan_calculations
      ),
      loan_final AS (
        SELECT
          *,
          (principal + accrued_interest - total_repaid) as total_owed,
          CASE 
            WHEN approved_at IS NOT NULL THEN (approved_at + (effective_term_ledgers * ${LEDGER_CLOSE_SECONDS} || ' seconds')::interval)
            ELSE NOW()
          END as next_payment_deadline,
          CASE 
            WHEN is_defaulted = 1 THEN 'defaulted'
            WHEN (principal + accrued_interest - total_repaid) > 0.01 THEN 'active'
            ELSE 'repaid'
          END as status
        FROM loan_fin
      )
      SELECT *, COUNT(*) OVER() as full_count
      FROM loan_final
      WHERE ($3::text IS NULL OR status = $3)
        AND ($4::numeric IS NULL OR principal >= $4)
        AND ($5::numeric IS NULL OR principal <= $5)
        AND ($6::timestamp IS NULL OR approved_at >= $6)
        AND ($7::timestamp IS NULL OR approved_at <= $7)
        AND ($8::int IS NULL OR loan_id > $8)
      ORDER BY loan_id ASC
      LIMIT $9
    `;

    const cursorValue = cursor ? Number.parseInt(cursor, 10) : null;
    const queryParams = [
      borrower,
      currentLedger,
      status && status !== "all" ? status : null,
      amountRange?.min ?? null,
      amountRange?.max ?? null,
      dateRange?.start ?? null,
      dateRange?.end ?? null,
      cursorValue,
      limit + 1,
    ];

    const result = await query(loansQuery, queryParams);

    const totalCount =
      result.rows.length > 0 ? Number.parseInt(result.rows[0].full_count, 10) : 0;

    const hasNext = result.rows.length > limit;
    const trimmedRows = hasNext ? result.rows.slice(0, limit) : result.rows;

    const loans: BorrowerLoan[] = trimmedRows.map((row: any) => ({
      loanId: Number(row.loan_id),
      principal: Number.parseFloat(row.principal || "0"),
      accruedInterest: Number.parseFloat(row.accrued_interest || "0"),
      totalRepaid: Number.parseFloat(row.total_repaid || "0"),
      totalOwed: Number.parseFloat(row.total_owed || "0"),
      nextPaymentDeadline: new Date(row.next_payment_deadline).toISOString(),
      status: row.status as "active" | "repaid" | "defaulted",
      borrower: row.borrower,
      approvedAt: row.approved_at
        ? new Date(row.approved_at).toISOString()
        : null,
    }));

    const lastLoan = loans.length > 0 ? loans[loans.length - 1] : undefined;
    const nextCursor = hasNext && lastLoan ? String(lastLoan.loanId) : null;

    res.json(
      createCursorPaginatedResponse(
        {
          borrower,
          loans,
        },
        totalCount,
        limit,
        loans.length,
        nextCursor,
        Boolean(cursor),
      ),
    );
  },
);

/**
 * GET /api/loans/config
 */
export const getLoanConfigEndpoint = asyncHandler(async (_req: Request, res: Response) => {
  const loanConfig = getLoanConfig();

  res.json({
    success: true,
    data: {
      minScore: loanConfig.minScore,
      maxAmount: loanConfig.maxAmount,
      interestRatePercent: loanConfig.interestRatePercent,
      creditScoreThreshold: loanConfig.creditScoreThreshold,
    },
  });
});

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
      throw AppError.notFound("Loan not found", ErrorCode.LOAN_NOT_FOUND, "loanId");
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
      ErrorCode.MISSING_FIELD,
    );
  }

  if (borrowerPublicKey !== req.user?.publicKey) {
    throw AppError.forbidden(
      "borrowerPublicKey must match your authenticated wallet",
      ErrorCode.BORROWER_MISMATCH,
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
      ErrorCode.MISSING_FIELD,
    );
  }

  if (borrowerPublicKey !== req.user?.publicKey) {
    throw AppError.forbidden(
      "borrowerPublicKey must match your authenticated wallet",
      ErrorCode.BORROWER_MISMATCH,
    );
  }

  const loanIdNum = Number.parseInt(loanId, 10);
  if (!Number.isFinite(loanIdNum) || loanIdNum <= 0) {
    throw AppError.badRequest("Invalid loan ID", ErrorCode.INVALID_LOAN_ID, "loanId");
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
      throw AppError.badRequest("signedTxXdr is required", ErrorCode.MISSING_FIELD, "signedTxXdr");
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
