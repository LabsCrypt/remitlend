import { Request, Response } from "express";
import { query } from "../db/connection.js";
import { withStellarAndDbTransaction } from "../db/transaction.js";
import { AppError } from "../errors/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sorobanService } from "../services/sorobanService.js";
import { cacheService } from "../services/cacheService.js";
import {
  buildDepositorYieldHistory,
  computeApy,
  normalizeYieldHistoryDays,
} from "../services/yieldHistoryService.js";
import logger from "../utils/logger.js";
import {
  invalidateOnDeposit,
  invalidateOnWithdraw,
} from "../utils/cacheKeys.js";

/**
 * The on-chain share price is scaled by SHARE_PRICE_SCALE (1,000,000 = 1.0).
 * Divide the raw value by this constant to obtain the human-readable ratio.
 */
const SHARE_PRICE_SCALE = 1_000_000;

/** Cache TTL for share price reads (30 seconds). Brief because price can move
 *  each ledger, but long enough to absorb burst requests on the same block. */
const SHARE_PRICE_CACHE_TTL_SECONDS = 30;

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
    const [depositResult, loanResult, withdrawalCooldownLedgers] =
      await Promise.all([
        query(`
      SELECT
        COALESCE(SUM(CASE WHEN event_type = 'Deposit' THEN CAST(amount AS NUMERIC) ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN event_type = 'Withdraw' THEN CAST(amount AS NUMERIC) ELSE 0 END), 0)
        AS total_deposits
      FROM contract_events
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
      FROM contract_events
      WHERE event_type IN ('LoanApproved', 'LoanRepaid')
    `),
        sorobanService.getWithdrawalCooldownLedgers().catch(() => 0),
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
        withdrawalCooldownLedgers,
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
        MIN(CASE WHEN event_type = 'Deposit' THEN ledger_closed_at END) AS first_deposit_at,
        MAX(CASE WHEN event_type = 'Deposit' THEN ledger_closed_at END) AS last_deposit_at
      FROM contract_events
      WHERE event_type IN ('Deposit', 'Withdraw')
        AND address = $1
      `,
        [address],
      ),
      query(`
      SELECT
        COALESCE(SUM(CASE WHEN event_type = 'Deposit' THEN CAST(amount AS NUMERIC) ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN event_type = 'Withdraw' THEN CAST(amount AS NUMERIC) ELSE 0 END), 0)
        AS pool_total
      FROM contract_events
      WHERE event_type IN ('Deposit', 'Withdraw')
    `),
    ]);

    const depositAmount = safeFloat(depositorResult.rows[0]?.deposit_amount);
    const poolTotal = safeFloat(poolTotalResult.rows[0]?.pool_total);
    const firstDepositAt = depositorResult.rows[0]?.first_deposit_at ?? null;
    const lastDepositAt = depositorResult.rows[0]?.last_deposit_at ?? null;

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
        lastDepositAt,
      },
    });
  },
);

/**
 * GET /api/pool/depositor/:address/yield-history
 * Returns a time series of depositor yield reconstructed from indexed pool events.
 */
export const getDepositorYieldHistory = asyncHandler(
  async (req: Request, res: Response) => {
    const address = req.params.address as string;
    const days = normalizeYieldHistoryDays(
      req.query.days ? Number(req.query.days) : undefined,
    );
    const token =
      typeof req.query.token === "string" && req.query.token.length > 0
        ? req.query.token
        : process.env.POOL_TOKEN_ADDRESS;

    if (!token) {
      throw AppError.internal("POOL_TOKEN_ADDRESS is not configured");
    }

    let currentSharePrice: number | undefined;
    try {
      currentSharePrice = await sorobanService.getSharePrice(token);
    } catch (error) {
      logger.warn("Could not fetch on-chain share price for yield history", {
        address,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const history = await buildDepositorYieldHistory(
      address,
      token,
      days,
      currentSharePrice,
    );

    const firstTimestamp = history[0]?.timestamp;
    const daysElapsed = firstTimestamp
      ? Math.max(
          1,
          (Date.now() - new Date(firstTimestamp).getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : 1;

    const data = history.map((point) => ({
      timestamp: point.timestamp,
      depositedValue: point.depositedValue,
      currentValue: point.currentValue,
      netYield: point.netYield,
      date: point.timestamp,
      earnings: point.netYield,
      principal: point.depositedValue,
      apy: computeApy(point.netYield, point.depositedValue, daysElapsed),
    }));

    res.json({ success: true, data });
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

    // Invalidate stale pool stats cache now that a deposit has been initiated
    await invalidateOnDeposit(depositorPublicKey);

    logger.withContext().info("Deposit transaction built", {
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

    // Invalidate stale pool stats cache now that a withdrawal has been initiated
    await invalidateOnWithdraw(depositorPublicKey);

    logger.withContext().info("Withdraw transaction built", {
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
 * POST /api/pool/build-emergency-withdraw
 * Build an unsigned LendingPool emergency_withdraw transaction.
 */
export const emergencyWithdrawFromPool = asyncHandler(
  async (req: Request, res: Response) => {
    const { depositorPublicKey, token, shares } = req.body as {
      depositorPublicKey: string;
      token: string;
      shares: number;
    };

    if (!depositorPublicKey || !token || !shares || shares <= 0) {
      throw AppError.badRequest(
        "depositorPublicKey, token, and a positive shares amount are required",
      );
    }

    if (depositorPublicKey !== req.user?.publicKey) {
      throw AppError.forbidden(
        "depositorPublicKey must match your authenticated wallet",
      );
    }

    const result = await sorobanService.buildEmergencyWithdrawTx(
      depositorPublicKey,
      token,
      shares,
    );

    logger.info("Emergency withdraw transaction built", {
      depositor: depositorPublicKey,
      token,
      shares,
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
      async (stellarResult: unknown, client) => {
        const sr = stellarResult as { txHash: string; status: string };
        await client.query(
          `INSERT INTO transaction_submissions (tx_hash, status, submitted_at, submitted_by, transaction_type)
           VALUES ($1, $2, NOW(), $3, $4)
           ON CONFLICT (tx_hash) DO UPDATE SET
             status = EXCLUDED.status,
             submitted_at = EXCLUDED.submitted_at`,
          [sr.txHash, sr.status, req.user?.publicKey || null, "pool"],
        );

        logger.withContext().info("Pool transaction submission recorded", {
          txHash: sr.txHash,
          status: sr.status,
          submittedBy: req.user?.publicKey,
          transactionType: "pool",
        });

        return { recorded: true };
      },
    );

    const sr = result.stellarResult as {
      txHash: string;
      status: string;
      resultXdr?: string;
    };

    logger.withContext().info("Pool transaction submitted successfully", {
      txHash: sr.txHash,
      status: sr.status,
    });

    res.json({
      success: true,
      txHash: sr.txHash,
      status: sr.status,
      ...(sr.resultXdr ? { resultXdr: sr.resultXdr } : {}),
    });
  },
);

/**
 * GET /api/pool/:token/share-price
 * Returns the current on-chain share price for the given token.
 * Cached briefly to absorb burst requests.
 */
export const getPoolSharePrice = asyncHandler(
  async (req: Request, res: Response) => {
    const token = req.params.token as string;

    if (!token) {
      throw AppError.badRequest("Token address is required");
    }

    const cacheKey = `pool:share-price:${token}`;
    const cached = await cacheService.get<{
      sharePrice: number;
      sharePriceRatio: number;
    }>(cacheKey);

    if (cached !== null) {
      res.json({
        success: true,
        data: cached,
        cached: true,
      });
      return;
    }

    const sharePrice = await sorobanService.getSharePrice(token);
    const sharePriceRatio = sharePrice / SHARE_PRICE_SCALE;

    const data = { sharePrice, sharePriceRatio };

    await cacheService.set(cacheKey, data, SHARE_PRICE_CACHE_TTL_SECONDS);

    res.json({
      success: true,
      data,
      cached: false,
    });
  },
);
