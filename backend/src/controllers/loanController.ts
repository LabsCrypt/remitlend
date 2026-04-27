


import type { Request, Response, NextFunction } from "express";
import { query } from "../db/connection.js";
import {
  withTransaction,
  withStellarAndDbTransaction,
} from "../db/transaction.js";
import { AppError } from "../errors/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { getLoanConfig } from "../config/loanConfig.js";
import { ErrorCode } from "../errors/errorCodes.js";
import { sorobanService } from "../services/sorobanService.js";
import {
  createCursorPaginatedResponse,
  parseCursorQueryParams,
} from "../utils/pagination.js";
import logger from "../utils/logger.js";
import { cacheService } from "../services/cacheService.js";

// ─── Test/Dev Only ────────────────────────────────────────────────────────────

/**
 * POST /api/loans (TEST/DEV ONLY)
 * Creates a loan directly for test setup.
 */
export const createTestLoan = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const { amount, term } = req.body;
    const borrower = req.user?.publicKey || "test-borrower";

    if (!amount || !term) {
      res.status(400).json({ success: false, message: "amount and term required" });
      return;
    }

    const loanResult = await query(
      `INSERT INTO loan_events (borrower, event_type, amount, ledger, ledger_closed_at) VALUES ($1, 'LoanRequested', $2, NULL, NOW()) RETURNING loan_id`,
      [borrower, amount],
    );
    const loanId = loanResult.rows[0].loan_id;

    await query(
      `INSERT INTO loan_events (loan_id, borrower, event_type, amount, interest_rate_bps, term_ledgers, ledger, ledger_closed_at) VALUES ($1, $2, 'LoanApproved', $3, 1200, $4, NULL, NOW())`,
      [loanId, borrower, amount, term],
    );

    res.json({ success: true, id: loanId, loan: { id: loanId, amount, term, borrower } });
  },
);

/**
 * POST /api/loans/:loanId/mark-defaulted (TEST/DEV ONLY)
 * Helper endpoint to mark a loan as defaulted for test setup.
 */
export const markLoanDefaulted = asyncHandler(
  async (req: Request, res: Response) => {
    const loanId = req.params.loanId as string;
    const borrower = req.body.borrower || req.user?.publicKey || null;

    const loanResult = await query(
      `SELECT loan_id FROM loan_events WHERE loan_id = $1 LIMIT 1`,
      [loanId],
    );
    if (loanResult.rows.length === 0) {
      throw AppError.badRequest("Loan does not exist");
    }

    await query(
      `INSERT INTO loan_events (loan_id, borrower, event_type, amount, ledger, ledger_closed_at) VALUES ($1, $2, 'LoanDefaulted', NULL, NULL, NOW())`,
      [loanId, borrower],
    );

    res.json({ success: true, message: "Loan marked as defaulted for test setup." });
  },
);

/**
 * POST /api/loans/:loanId/contest-default
 * Allows a borrower to contest a defaulted loan, moving it to disputed status and logging the dispute.
 */
export const contestDefault = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const loanId = req.params.loanId as string;
    const { reason } = req.body as { reason: string };
    const borrower = req.user?.publicKey;

    if (!reason || reason.trim().length < 5) {
      throw AppError.badRequest("A valid reason for contesting is required.");
    }
    if (!borrower) {
      throw AppError.unauthorized("Authentication required");
    }

    // Check loan exists and is defaulted
    const loanResult = await query(
      `SELECT loan_id FROM loan_events WHERE loan_id = $1 AND event_type = 'LoanDefaulted' LIMIT 1`,
      [loanId],
    );
    if (loanResult.rows.length === 0) {
      throw AppError.badRequest("Loan is not defaulted or does not exist");
    }

    // Insert dispute record and return disputeId
    const disputeResult = await query(
      `INSERT INTO loan_disputes (loan_id, borrower, reason, status) VALUES ($1, $2, $3, 'open') RETURNING id`,
      [loanId, borrower, reason],
    );

    // Optionally: update loan status to 'disputed' in your loan status tracking (if applicable)
    // If you have a loan status table/column, update it here. If only events, you may want to insert a new event:
    await query(
      `INSERT INTO loan_events (loan_id, borrower, event_type, amount, ledger, ledger_closed_at) VALUES ($1, $2, 'LoanDisputed', NULL, NULL, NOW())`,
      [loanId, borrower],
    );

    // TODO: Notify admins (e.g., via email, dashboard alert, etc.)
    logger.info("Loan default contested", { loanId, borrower, reason });

    res.json({
      success: true,
      disputeId: disputeResult.rows[0].id,
      message: "Loan default contested. Admins will review your dispute.",
    });
  },
);

const LEDGER_CLOSE_SECONDS = 5;
const DEFAULT_TERM_LEDGERS = 17280; // 1 day in ledgers
const DEFAULT_INTEREST_RATE_BPS = 1200; // 12%

type BorrowerLoan = {
  loanId: number;
  principal: number;
  accruedInterest: number | null;
  totalRepaid: number;
  totalOwed: number | null;
  nextPaymentDeadline: string;
  status: "active" | "repaid" | "defaulted" | "pending_indexing";
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

const roundToCents = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
};

const buildAmortizationSchedule = (
  principal: number,
  interestRateBps: number,
  termLedgers: number,
  startDate: Date,
) => {
  const totalInterest = principal * (interestRateBps / 10000);
  const totalDue = principal + totalInterest;

  const LEDGER_DAY = 17280; // 1 day in ledgers
  const termDays = termLedgers / LEDGER_DAY;

  const periodCount = Math.max(1, Math.round(termDays / 30) || 1);
  const daysPerPeriod = termDays / periodCount;

  const rawPrincipalPortion = principal / periodCount;
  const rawInterestPortion = totalInterest / periodCount;

  const schedule = [] as Array<{
    date: string;
    principalPortion: number;
    interestPortion: number;
    totalDue: number;
    runningBalance: number;
  }>;

  let remainingPrincipal = principal;
  let remainingInterest = totalInterest;

  for (let i = 1; i <= periodCount; i++) {
    const isLast = i === periodCount;

    const principalPortion = isLast
      ? roundToCents(remainingPrincipal)
      : roundToCents(rawPrincipalPortion);

    const interestPortion = isLast
      ? roundToCents(remainingInterest)
      : roundToCents(rawInterestPortion);

    remainingPrincipal = roundToCents(remainingPrincipal - principalPortion);
    remainingInterest = roundToCents(remainingInterest - interestPortion);

    const dueDate = addDays(startDate, Math.round(daysPerPeriod * i));

    schedule.push({
      date: dueDate.toISOString(),
      principalPortion,
      interestPortion,
      totalDue: roundToCents(principalPortion + interestPortion),
      runningBalance: Math.max(0, remainingPrincipal),
    });
  }

  return {
    principal: roundToCents(principal),
    interestRateBps,
    termLedgers,
    totalInterest: roundToCents(totalInterest),
    totalDue: roundToCents(totalDue),
    schedule,
  };
};

export const previewLoanAmortizationSchedule = asyncHandler(
  async (req: Request, res: Response) => {
    const { amount, termDays } = req.body as {
      amount: number;
      termDays: 30 | 60 | 90;
    };

    const loanConfig = getLoanConfig();
    const interestRateBps = Math.round(loanConfig.interestRatePercent * 100);
    const termLedgers = termDays * DEFAULT_TERM_LEDGERS;

    const amortization = buildAmortizationSchedule(
      amount,
      interestRateBps,
      termLedgers,
      new Date(),
    );

    res.json({
      success: true,
      amortization,
    });
  },
);

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
            WHEN approved_ledger IS NULL OR approved_ledger = 0 OR $2 < approved_ledger THEN 'pending_indexing'
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
      result.rows.length > 0
        ? Number.parseInt(result.rows[0].full_count, 10)
        : 0;

    const hasNext = result.rows.length > limit;
    const trimmedRows = hasNext ? result.rows.slice(0, limit) : result.rows;

    const loans: BorrowerLoan[] = trimmedRows.map((row: any) => {
      const isPending = row.status === "pending_indexing";
      return {
        loanId: Number(row.loan_id),
        principal: Number.parseFloat(row.principal || "0"),
        accruedInterest: isPending ? null : Number.parseFloat(row.accrued_interest || "0"),
        totalRepaid: Number.parseFloat(row.total_repaid || "0"),
        totalOwed: isPending ? null : Number.parseFloat(row.total_owed || "0"),
        nextPaymentDeadline: new Date(row.next_payment_deadline).toISOString(),
        status: row.status as "active" | "repaid" | "defaulted" | "pending_indexing",
        borrower: row.borrower,
        approvedAt: row.approved_at
          ? new Date(row.approved_at).toISOString()
          : null,
      };
    });

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
export const getLoanConfigEndpoint = asyncHandler(
  async (_req: Request, res: Response) => {
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
      throw AppError.notFound(
        "Loan not found",
        ErrorCode.LOAN_NOT_FOUND,
        "loanId",
      );
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

    // Check for open dispute
    const disputeResult = await query(
      `SELECT created_at FROM loan_disputes WHERE loan_id = $1 AND status = 'open' ORDER BY created_at ASC LIMIT 1`,
      [loanId],
    );
    let freezeLedger: number | null = null;
    if (disputeResult.rows.length > 0) {
      // Find the ledger closest to dispute creation
      const disputeCreatedAt = new Date(disputeResult.rows[0].created_at);
      // Find the ledger that closed just before or at disputeCreatedAt
      const ledgerResult = await query(
        `SELECT ledger, ledger_closed_at FROM loan_events WHERE loan_id = $1 AND ledger_closed_at <= $2 ORDER BY ledger_closed_at DESC LIMIT 1`,
        [loanId, disputeCreatedAt],
      );
      freezeLedger = ledgerResult.rows.length > 0 ? ledgerResult.rows[0].ledger : null;
    }

    let elapsedLedgers: number;
    if (freezeLedger !== null) {
      elapsedLedgers = Math.max(0, freezeLedger - approvedLedger);
    } else {
      elapsedLedgers = Math.max(0, currentLedger - approvedLedger);
    }

    const isDefaulted = events.some(
      (event: any) => event.event_type === "LoanDefaulted",
    );

    const isPending = approvedLedger <= 0 || currentLedger < approvedLedger;

    const accruedInterest = isPending
      ? 0
      : (principal * rateBps * elapsedLedgers) / (10000 * termLedgers);
    const totalOwed = principal + accruedInterest - totalRepaid;

    res.json({
      success: true,
      loanId,
      summary: {
        principal,
        accruedInterest: isPending ? null : accruedInterest,
        totalRepaid,
        totalOwed: isPending ? null : totalOwed,
        interestRate: rateBps / 10000,
        termLedgers,
        elapsedLedgers,
        status: isPending
          ? "pending_indexing"
          : isDefaulted
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
        disputeFrozen: freezeLedger !== null,
      },
    });
  },
);

export const getLoanAmortizationSchedule = asyncHandler(
  async (req: Request, res: Response) => {
    const { loanId } = req.params;

    const eventsResult = await query(
      `SELECT event_type, amount, ledger_closed_at, interest_rate_bps, term_ledgers
       FROM loan_events
       WHERE loan_id = $1
       ORDER BY ledger_closed_at ASC`,
      [loanId],
    );

    if (eventsResult.rows.length === 0) {
      throw AppError.notFound(
        "Loan not found",
        ErrorCode.LOAN_NOT_FOUND,
        "loanId",
      );
    }

    const events = eventsResult.rows;
    const requestEvent = events.find(
      (event: any) => event.event_type === "LoanRequested",
    );
    const approvalEvent = events.find(
      (event: any) => event.event_type === "LoanApproved",
    );

    if (!requestEvent || !approvalEvent || !requestEvent.amount) {
      throw AppError.notFound(
        "Loan not fully approved",
        ErrorCode.LOAN_NOT_FOUND,
        "loanId",
      );
    }

    const principal = Number.parseFloat(String(requestEvent.amount));
    const interestRateBps = Number.parseInt(
      String(approvalEvent.interest_rate_bps ?? DEFAULT_INTEREST_RATE_BPS),
      10,
    );
    const termLedgers = Number.parseInt(
      String(approvalEvent.term_ledgers ?? DEFAULT_TERM_LEDGERS),
      10,
    );

    const approvedAt = approvalEvent.ledger_closed_at
      ? new Date(approvalEvent.ledger_closed_at)
      : new Date();

    const amortization = buildAmortizationSchedule(
      principal,
      interestRateBps,
      termLedgers,
      approvedAt,
    );

    res.json({
      success: true,
      loanId,
      amortization,
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

  if (borrowerPublicKey !== req.user?.publicKey) {
    throw AppError.forbidden(
      "borrowerPublicKey must match your authenticated wallet",
      ErrorCode.BORROWER_MISMATCH,
    );
  }

  if (
    process.env.NODE_ENV !== "test" &&
    "getPoolBalance" in sorobanService &&
    typeof (
      sorobanService as unknown as { getPoolBalance?: () => Promise<number> }
    ).getPoolBalance === "function"
  ) {
    const poolBalance = await (
      sorobanService as unknown as { getPoolBalance: () => Promise<number> }
    ).getPoolBalance();
    if (amount > poolBalance) {
      throw AppError.badRequest(
        "Insufficient pool liquidity to cover this loan",
        ErrorCode.INSUFFICIENT_BALANCE,
      );
    }
  }

  // Idempotency: return existing unsigned tx if recently built for this borrower/amount
  const cacheKey = `pending_loan_tx:${borrowerPublicKey}:${amount}`;
  const cachedTx = await cacheService.get<{
    unsignedTxXdr: string;
    networkPassphrase: string;
  }>(cacheKey);

  if (cachedTx) {
    logger.info("Returning cached unsigned loan request tx", {
      borrower: borrowerPublicKey,
      amount,
    });
    res.json({
      success: true,
      unsignedTxXdr: cachedTx.unsignedTxXdr,
      networkPassphrase: cachedTx.networkPassphrase,
    });
    return;
  }

  const result = await sorobanService.buildRequestLoanTx(
    borrowerPublicKey,
    amount,
  );

  // Cache for 60 seconds to prevent sequence number collisions from rapid requests
  await cacheService.set(cacheKey, result, 60);

  logger.info("Loan request transaction built", {
    borrower: borrowerPublicKey,
    amount,
  });

  res.json({
    success: true,
    unsignedTxXdr: result.unsignedTxXdr,
    networkPassphrase: result.networkPassphrase,
  });
  return;
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

  if (borrowerPublicKey !== req.user?.publicKey) {
    throw AppError.forbidden(
      "borrowerPublicKey must match your authenticated wallet",
      ErrorCode.BORROWER_MISMATCH,
    );
  }

  const loanIdNum = Number.parseInt(loanId, 10);
  if (!Number.isFinite(loanIdNum) || loanIdNum <= 0) {
    throw AppError.badRequest(
      "Invalid loan ID",
      ErrorCode.INVALID_LOAN_ID,
      "loanId",
    );
  }

  // Idempotency: return existing unsigned tx if recently built for this borrower/loan/amount
  const cacheKey = `pending_repay_tx:${borrowerPublicKey}:${loanIdNum}:${amount}`;
  const cachedTx = await cacheService.get<{
    unsignedTxXdr: string;
    networkPassphrase: string;
  }>(cacheKey);

  if (cachedTx) {
    logger.info("Returning cached unsigned repay tx", {
      borrower: borrowerPublicKey,
      loanId: loanIdNum,
      amount,
    });
    res.json({
      success: true,
      loanId: loanIdNum,
      unsignedTxXdr: cachedTx.unsignedTxXdr,
      networkPassphrase: cachedTx.networkPassphrase,
    });
    return;
  }

  const result = await sorobanService.buildRepayTx(
    borrowerPublicKey,
    loanIdNum,
    amount,
  );

  // Cache for 60 seconds
  await cacheService.set(cacheKey, result, 60);

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
  return;
});

/**
 * POST /api/loans/submit
 * POST /api/loans/:loanId/submit
 */
export const submitTransaction = asyncHandler(
  async (req: Request, res: Response) => {
    const { signedTxXdr } = req.body as { signedTxXdr: string };

    if (!signedTxXdr) {
      throw AppError.badRequest(
        "signedTxXdr is required",
        ErrorCode.MISSING_FIELD,
        "signedTxXdr",
      );
    }

    // Use transaction wrapper for consistency with multi-step operations
    const result = await withStellarAndDbTransaction(
      // Stellar operation
      async () => {
        return await sorobanService.submitSignedTx(signedTxXdr);
      },
      // Database operations (currently none, but structured for future use)
      async (stellarResult, client) => {
        // Log the transaction submission for audit and reconciliation
        await client.query(
          `INSERT INTO transaction_submissions (tx_hash, status, submitted_at, submitted_by)
           VALUES ($1, $2, NOW(), $3)
           ON CONFLICT (tx_hash) DO UPDATE SET
             status = EXCLUDED.status,
             submitted_at = EXCLUDED.submitted_at`,
          [
            stellarResult.txHash,
            stellarResult.status,
            req.user?.publicKey || null,
          ],
        );

        logger.info("Transaction submission recorded", {
          txHash: stellarResult.txHash,
          status: stellarResult.status,
          submittedBy: req.user?.publicKey,
        });

        return { recorded: true };
      },
    );

    logger.info("Transaction submitted successfully", {
      txHash: result.stellarResult.txHash,
      status: result.stellarResult.status,
    });

    res.json({
      success: true,
      txHash: result.stellarResult.txHash,
      status: result.stellarResult.status,
      ...(result.stellarResult.resultXdr
        ? { resultXdr: result.stellarResult.resultXdr }
        : {}),
    });
  },
);
