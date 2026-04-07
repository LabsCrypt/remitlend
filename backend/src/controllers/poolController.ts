import { Request, Response } from "express";
import { query } from "../db/connection.js";
import logger from "../utils/logger.js";

const ANNUAL_APY = 0.08; // 8% annual yield paid to depositors

/**
 * GET /api/pool/stats
 * Returns aggregate pool statistics for the lender dashboard.
 */
export const getPoolStats = async (_req: Request, res: Response) => {
  try {
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
          COUNT(DISTINCT loan_id) FILTER (
            WHERE event_type = 'LoanApproved'
          ) AS active_loans_count,
          COALESCE(SUM(CASE WHEN event_type = 'LoanApproved' THEN CAST(amount AS NUMERIC) ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN event_type = 'LoanRepaid' THEN CAST(amount AS NUMERIC) ELSE 0 END), 0)
          AS total_outstanding
        FROM loan_events
        WHERE event_type IN ('LoanApproved', 'LoanRepaid')
      `),
    ]);

    const totalDeposits = parseFloat(
      depositResult.rows[0]?.total_deposits ?? "0",
    );
    const totalOutstanding = parseFloat(
      loanResult.rows[0]?.total_outstanding ?? "0",
    );
    const activeLoansCount = parseInt(
      loanResult.rows[0]?.active_loans_count ?? "0",
      10,
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
      },
    });
  } catch (error) {
    logger.error("Failed to get pool stats", { error });
    res.status(500).json({
      success: false,
      message: "Failed to fetch pool statistics",
    });
  }
};

/**
 * GET /api/pool/depositor/:address
 * Returns portfolio details for a specific depositor address.
 */
export const getDepositorPortfolio = async (req: Request, res: Response) => {
  try {
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

    const depositAmount = parseFloat(
      depositorResult.rows[0]?.deposit_amount ?? "0",
    );
    const poolTotal = parseFloat(poolTotalResult.rows[0]?.pool_total ?? "0");
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
  } catch (error) {
    logger.error("Failed to get depositor portfolio", { error });
    res.status(500).json({
      success: false,
      message: "Failed to fetch depositor portfolio",
    });
  }
};
