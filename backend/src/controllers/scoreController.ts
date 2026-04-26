import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { query } from "../db/connection.js";
import { cacheService } from "../services/cacheService.js";
import { AppError } from "../errors/AppError.js";

// ---------------------------------------------------------------------------
// Score computation helpers
// ---------------------------------------------------------------------------

/** Credit bands matching typical lending tiers */
type CreditBand = "Excellent" | "Good" | "Fair" | "Poor";

function getCreditBand(score: number): CreditBand {
  if (score >= 750) return "Excellent";
  if (score >= 670) return "Good";
  if (score >= 580) return "Fair";
  return "Poor";
}

// ---------------------------------------------------------------------------
// Score delta constants (tunable)
// ---------------------------------------------------------------------------
/** Points awarded for an on-time repayment */
const ON_TIME_DELTA = 15;
/** Points deducted for a late / missed repayment */
const LATE_DELTA = -30;

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------

/**
 * GET /api/score/:userId
 *
 * Returns the current credit score for a user along with their credit band
 * and the key factors that influence the score.  Intended to be called by
 * LoanManager and other contracts that need to make lending decisions.
 */
export const getScore = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.params as { userId: string };

  const cacheKey = `score:userId:${userId}`;
  const cachedScoreParams = await cacheService.get<{
    score: number;
    band: CreditBand;
  }>(cacheKey);

  if (cachedScoreParams) {
    res.json({
      success: true,
      userId,
      score: cachedScoreParams.score,
      band: cachedScoreParams.band,
      factors: {
        repaymentHistory: "On-time payments increase score by 15 pts each",
        latePaymentPenalty: "Late payments decrease score by 30 pts each",
        range: "500 (Poor) – 850 (Excellent)",
      },
    });
    return;
  }

  const result = await query(
    "SELECT current_score FROM scores WHERE user_id = $1",
    [userId],
  );

  const score = result.rows.length > 0 ? result.rows[0].current_score : 500;
  const band = getCreditBand(score);

  await cacheService.set(cacheKey, { score, band }, 300); // 5 minutes TTL

  res.json({
    success: true,
    userId,
    score,
    band,
    factors: {
      repaymentHistory: "On-time payments increase score by 15 pts each",
      latePaymentPenalty: "Late payments decrease score by 30 pts each",
      range: "500 (Poor) – 850 (Excellent)",
    },
  });
});

/**
 * POST /api/score/update
 *
 * Updates a user's credit score based on a single repayment event.
 * Protected by the `requireApiKey` middleware — only authorised internal
 * services (e.g. LoanManager workers) may call this endpoint.
 *
 * Body: { userId: string, repaymentAmount: number, onTime: boolean }
 */
export const updateScore = asyncHandler(async (req: Request, res: Response) => {
  const { userId, repaymentAmount, onTime } = req.body as {
    userId: string;
    repaymentAmount: number;
    onTime: boolean;
  };

  // Get old score first for the response
  const oldResult = await query(
    "SELECT current_score FROM scores WHERE user_id = $1",
    [userId],
  );
  const oldScore =
    oldResult.rows.length > 0 ? oldResult.rows[0].current_score : 500;

  const delta = onTime ? ON_TIME_DELTA : LATE_DELTA;

  // Use UPSERT: Get existing score or start at 500, then apply delta and clamp
  const result = await query(
    `INSERT INTO scores (user_id, current_score)
     VALUES ($1, $2)
     ON CONFLICT (user_id) 
     DO UPDATE SET 
       current_score = LEAST(850, GREATEST(300, scores.current_score + $3)),
       updated_at = CURRENT_TIMESTAMP
     RETURNING current_score`,
    [userId, 500 + delta, delta],
  );

  const newScore = result.rows[0].current_score;
  const band = getCreditBand(newScore);

  // Invalidate cache
  const cacheKey = `score:userId:${userId}`;
  await cacheService.delete(cacheKey);

  res.json({
    success: true,
    userId,
    repaymentAmount,
    onTime,
    oldScore,
    delta,
    newScore,
    band,
  });
});

/**
 * GET /api/score/:userId/breakdown
 *
 * Returns a detailed breakdown of the factors contributing to the user's
 * credit score, derived from loan_events and scores tables. Gives borrowers
 * transparency into their credit profile.
 *
 * OPTIMIZED: Single CTE query combines all breakdown computations:
 * - Current score fetch
 * - Loan event aggregations (total, repaid, defaulted counts)
 * - On-time vs late repayment classification
 * - Average repayment time calculation
 * - Repayment history for streak/timeline computation
 *
 * This reduces 6+ separate queries to 1-2 efficient round-trips.
 */
export const getScoreBreakdown = asyncHandler(
  async (req: Request, res: Response) => {
    const { userId } = req.params as { userId: string };

    const cacheKey = `score:breakdown:${userId}`;
    const cached = await cacheService.get<Record<string, unknown>>(cacheKey);
    if (cached) {
      res.json({ success: true, ...cached });
      return;
    }

    // Single unified query that computes all breakdown metrics
    const breakdownResult = await query(
      `WITH 
       -- Current score from scores table
       current_score_cte AS (
         SELECT COALESCE(current_score, 500) AS current_score
         FROM scores
         WHERE user_id = $1
       ),
       -- All loan events for this borrower
       borrower_events AS (
         SELECT 
           loan_id,
           event_type,
           ledger,
           ledger_closed_at,
           amount,
           term_ledgers
         FROM contract_events
         WHERE address = $1
       ),
       -- Loan approval details (ledger and term)
       approved_loans AS (
         SELECT 
           loan_id,
           MAX(ledger) AS approved_ledger,
           MAX(COALESCE(term_ledgers, 17280)) AS term_ledgers
         FROM borrower_events
         WHERE event_type = 'LoanApproved' AND loan_id IS NOT NULL
         GROUP BY loan_id
       ),
       -- Repaid loan details (ledger and timestamp)
       repaid_loans AS (
         SELECT 
           loan_id,
           MIN(ledger) AS repaid_ledger,
           MIN(ledger_closed_at) AS repaid_at
         FROM borrower_events
         WHERE event_type = 'LoanRepaid' AND loan_id IS NOT NULL
         GROUP BY loan_id
       ),
       -- Classification of repayments as on-time or late
       repayment_timing AS (
         SELECT 
           r.loan_id,
           r.repaid_ledger,
           r.repaid_at,
           CASE WHEN r.repaid_ledger <= a.approved_ledger + a.term_ledgers 
                THEN true ELSE false END AS on_time,
           (r.repaid_ledger - a.approved_ledger) AS repayment_ledgers
         FROM repaid_loans r
         JOIN approved_loans a ON a.loan_id = r.loan_id
       ),
       -- Aggregate statistics across all loans
       loan_stats AS (
         SELECT 
           COUNT(DISTINCT CASE WHEN event_type = 'LoanRequested' THEN loan_id END) AS total_loans,
           COUNT(DISTINCT CASE WHEN event_type = 'LoanRepaid' THEN loan_id END) AS repaid_count,
           COUNT(DISTINCT CASE WHEN event_type = 'LoanDefaulted' THEN loan_id END) AS defaulted_count,
           COALESCE(SUM(CASE WHEN event_type = 'LoanRepaid' THEN CAST(amount AS NUMERIC) ELSE 0 END), 0) AS total_repaid
         FROM borrower_events
       ),
       -- Repayment timing statistics
       timing_stats AS (
         SELECT 
           COUNT(*) FILTER (WHERE on_time) AS on_time_count,
           COUNT(*) FILTER (WHERE NOT on_time) AS late_count,
           AVG(repayment_ledgers) AS avg_repayment_ledgers
         FROM repayment_timing
       ),
       -- Final aggregated breakdown
       breakdown_summary AS (
         SELECT 
           cs.current_score,
           COALESCE(ls.total_loans, 0) AS total_loans,
           COALESCE(ls.repaid_count, 0) AS repaid_count,
           COALESCE(ls.defaulted_count, 0) AS defaulted_count,
           COALESCE(ls.total_repaid, 0) AS total_repaid,
           COALESCE(ts.on_time_count, 0) AS on_time_count,
           COALESCE(ts.late_count, 0) AS late_count,
           COALESCE(ts.avg_repayment_ledgers, 0) AS avg_repayment_ledgers
         FROM current_score_cte cs
         CROSS JOIN loan_stats ls
         CROSS JOIN timing_stats ts
       )
       SELECT 
         current_score,
         total_loans,
         repaid_count,
         defaulted_count,
         total_repaid,
         on_time_count,
         late_count,
         avg_repayment_ledgers
       FROM breakdown_summary`,
      [userId],
    );

    const breakdown = breakdownResult.rows[0] || {};
    const score = parseInt(breakdown.current_score || "500", 10);
    const band = getCreditBand(score);
    const totalLoans = parseInt(breakdown.total_loans || "0", 10);
    const repaidOnTime = parseInt(breakdown.on_time_count || "0", 10);
    const repaidLate = parseInt(breakdown.late_count || "0", 10);
    const defaultedCount = parseInt(breakdown.defaulted_count || "0", 10);
    const totalRepaid = parseFloat(breakdown.total_repaid || "0");

    // Convert average ledgers to days (1 ledger ≈ 5 seconds)
    const avgLedgers = parseFloat(breakdown.avg_repayment_ledgers || "0");
    const avgDays = Math.round((avgLedgers * 5) / 86400);
    const averageRepaymentTime = avgLedgers > 0 ? `${avgDays} days` : "N/A";

    // Fetch detailed history for streak calculation (separate query is minimal overhead)
    const historyResult = await query(
      `SELECT 
         event_type,
         ledger_closed_at
       FROM contract_events
       WHERE address = $1 AND event_type IN ('LoanRepaid', 'LoanDefaulted')
       ORDER BY ledger_closed_at ASC`,
      [userId],
    );

    // Build score history by replaying deltas from base 500
    let runningScore = 500;
    const history = historyResult.rows.map((row: Record<string, unknown>) => {
      if (row.event_type === "LoanRepaid") {
        runningScore = Math.min(850, runningScore + ON_TIME_DELTA);
      } else if (row.event_type === "LoanDefaulted") {
        runningScore = Math.max(300, runningScore - 50);
      }
      return {
        date: row.ledger_closed_at
          ? new Date(row.ledger_closed_at as string).toISOString().split("T")[0]
          : null,
        score: runningScore,
        event: row.event_type,
      };
    });

    // Calculate streaks from history
    let longestStreak = 0;
    let currentStreak = 0;
    let tempStreak = 0;

    for (const histItem of history) {
      if (histItem.event === "LoanRepaid") {
        tempStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
      } else {
        tempStreak = 0;
      }
    }
    currentStreak = tempStreak;

    const responseData = {
      userId,
      score,
      band,
      breakdown: {
        totalLoans,
        repaidOnTime,
        repaidLate,
        defaulted: defaultedCount,
        totalRepaid,
        averageRepaymentTime,
        longestStreak,
        currentStreak,
      },
      history,
    };

    await cacheService.set(cacheKey, responseData, 300);

    res.json({ success: true, ...responseData });
  },
);
