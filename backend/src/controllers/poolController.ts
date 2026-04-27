import { Request, Response } from "express";
import { query } from "../db/connection.js";
import { withStellarAndDbTransaction } from "../db/transaction.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/errorCodes.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sorobanService } from "../services/sorobanService.js";
import logger from "../utils/logger.js";

const ANNUAL_APY = 0.08; // 8% annual yield paid to depositors

/**
 * Parse a database value to a finite number, returning `fallback` (default 0)
 * when the input is null, undefined, an empty string, or non-finite (NaN / Infinity).
 * Prevents silent NaN propagation when SQL aggregations return null for empty tables.
 */
function safeFloat(value: unknown, fallback = 0): number {
  const n = parseFloat(String(value ?? fallback));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * GET /api/pool/stats
 * Returns aggregate pool statistics for the lender dashboard.
 */
export const getPoolStats = asyncHandler(
  async (_req: Request, res: Response) => {
    const [depositResult, loanResult] = await Promise.all([
      query(`
      SELECT
        COALESCE(SUM(CASE WHEN event_type = 'Deposit' THEN CAST(amount AS NUMERIC) ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN event_type = 'Withdraw' THEN CAST(amount AS NUMERIC) ELSE 0 END), 0)
        AS total_deposits
      FROM loan_events
      WHERE event_type IN ('Deposit', 'Withdraw')
    `),
      query(`
      SELECT
        COALESCE(COUNT(DISTINCT loan_id) FILTER (
          WHERE event_type = 'LoanApproved'
        ), 0) AS active_loans_count,
        COALESCE(SUM(CASE WHEN event_type = 'LoanApproved' THEN CAST(amount AS NUMERIC) ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN event_type = 'LoanRepaid' THEN CAST(amount AS NUMERIC) ELSE 0 END), 0)
        AS total_outstanding
      FROM loan_events
      WHERE event_type IN ('LoanApproved', 'LoanRepaid')
    `),
    ]);

    const totalDeposits = safeFloat(depositResult.rows[0]?.total_deposits);
    const totalOutstanding = safeFloat(loanResult.rows[0]?.total_outstanding);
    const activeLoansCount = Math.trunc(
      safeFloat(loanResult.rows[0]?.active_loans_count),
    );

    const utilizationRate =
      totalDeposits > 0 ? Math.min(totalOutstanding / totalDeposits, 1) : 0;

    res.json({
      success: true,
      data: {
        totalDeposits,
        totalOutstanding,
        utilizationRate: parseFloat(utilizationRate.toFixed(4)),
        apy: ANNUAL_APY,
        activeLoansCount,
        poolTokenAddress: process.env.POOL_TOKEN_ADDRESS,
      },
    });
  },
);

/**
 * GET /api/pool/depositor/:address
 * Returns portfolio details for a specific depositor address.
 */
export const getDepositorPortfolio = asyncHandler(
  async (req: Request, res: Response) => {
    const { address } = req.params;

    const [depositorResult, poolTotalResult] = await Promise.all([
      query(
        `
      SELECT
        COALESCE(SUM(CASE WHEN event_type = 'Deposit' THEN CAST(amount AS NUMERIC) ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN event_type = 'Withdraw' THEN CAST(amount AS NUMERIC) ELSE 0 END), 0)
        AS deposit_amount,
        MIN(CASE WHEN event_type = 'Deposit' THEN ledger_closed_at END) AS first_deposit_at
      FROM loan_events
      WHERE event_type IN ('Deposit', 'Withdraw')
        AND borrower = $1
      `,
        [address],
      ),
      query(`
      SELECT
        COALESCE(SUM(CASE WHEN event_type = 'Deposit' THEN CAST(amount AS NUMERIC) ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN event_type = 'Withdraw' THEN CAST(amount AS NUMERIC) ELSE 0 END), 0)
        AS pool_total
      FROM loan_events
      WHERE event_type IN ('Deposit', 'Withdraw')
    `),
    ]);

    const depositAmount = safeFloat(depositorResult.rows[0]?.deposit_amount);
    const poolTotal = safeFloat(poolTotalResult.rows[0]?.pool_total);
    const firstDepositAt = depositorResult.rows[0]?.first_deposit_at ?? null;

    const sharePercent = poolTotal > 0 ? depositAmount / poolTotal : 0;

    const daysDeposited = firstDepositAt
      ? Math.max(
          0,
          (Date.now() - new Date(firstDepositAt).getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : 0;

    const estimatedYield = depositAmount * ANNUAL_APY * (daysDeposited / 365);

    res.json({
      success: true,
      data: {
        address,
        depositAmount,
        sharePercent: parseFloat(sharePercent.toFixed(6)),
        estimatedYield: parseFloat(estimatedYield.toFixed(7)),
        apy: ANNUAL_APY,
        firstDepositAt,
      },
    });
  },
);

/**
 * POST /api/pool/build-deposit
 * Build an unsigned LendingPool deposit transaction.
 */
export const depositToPool = asyncHandler(
  async (req: Request, res: Response) => {
    const { depositorPublicKey, token, amount } = req.body as {
      depositorPublicKey: string;
      token: string;
      amount: number;
    };

    if (!depositorPublicKey || !token || !amount || amount <= 0) {
      throw AppError.badRequest(
        "depositorPublicKey, token, and a positive amount are required",
      );
    }

    if (depositorPublicKey !== req.user?.publicKey) {
      throw AppError.forbidden(
        "depositorPublicKey must match your authenticated wallet",
      );
    }

    const result = await sorobanService.buildDepositTx(
      depositorPublicKey,
      token,
      amount,
    );

    logger.info("Deposit transaction built", {
      depositor: depositorPublicKey,
      token,
      amount,
    });

    res.json({
      success: true,
      unsignedTxXdr: result.unsignedTxXdr,
      networkPassphrase: result.networkPassphrase,
    });
  },
);

/**
 * POST /api/pool/build-withdraw
 * Build an unsigned LendingPool withdraw transaction.
 */
export const withdrawFromPool = asyncHandler(
  async (req: Request, res: Response) => {
    const { depositorPublicKey, token, amount } = req.body as {
      depositorPublicKey: string;
      token: string;
      amount: number;
    };

    // Note: 'amount' here refers to shares to withdraw.
    if (!depositorPublicKey || !token || !amount || amount <= 0) {
      throw AppError.badRequest(
        "depositorPublicKey, token, and a positive amount (shares) are required",
      );
    }

    if (depositorPublicKey !== req.user?.publicKey) {
      throw AppError.forbidden(
        "depositorPublicKey must match your authenticated wallet",
      );
    }

    const result = await sorobanService.buildWithdrawTx(
      depositorPublicKey,
      token,
      amount,
    );

    logger.info("Withdraw transaction built", {
      depositor: depositorPublicKey,
      token,
      shares: amount,
    });

    res.json({
      success: true,
      unsignedTxXdr: result.unsignedTxXdr,
      networkPassphrase: result.networkPassphrase,
    });
  },
);

/**
 * POST /api/pool/submit
 * Submit a signed pool transaction to the Stellar network.
 */
export const submitPoolTransaction = asyncHandler(
  async (req: Request, res: Response) => {
    const { signedTxXdr } = req.body as { signedTxXdr: string };

    if (!signedTxXdr) {
      throw AppError.badRequest("signedTxXdr is required");
    }

    // Use transaction wrapper for consistency with multi-step operations
    const result = await withStellarAndDbTransaction(
      // Stellar operation
      async () => {
        return await sorobanService.submitSignedTx(signedTxXdr);
      },
      // Database operations (currently none, but structured for future use)
      async (stellarResult, client) => {
        // Log the pool transaction submission for audit and reconciliation
        await client.query(
          `INSERT INTO transaction_submissions (tx_hash, status, submitted_at, submitted_by, transaction_type)
           VALUES ($1, $2, NOW(), $3, $4)
           ON CONFLICT (tx_hash) DO UPDATE SET
             status = EXCLUDED.status,
             submitted_at = EXCLUDED.submitted_at`,
          [
            stellarResult.txHash,
            stellarResult.status,
            req.user?.publicKey || null,
            "pool",
          ],
        );

        logger.info("Pool transaction submission recorded", {
          txHash: stellarResult.txHash,
          status: stellarResult.status,
          submittedBy: req.user?.publicKey,
          transactionType: "pool",
        });

        return { recorded: true };
      },
    );

    logger.info("Pool transaction submitted successfully", {
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
