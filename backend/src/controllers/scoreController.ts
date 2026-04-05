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

    // Fetch current score
    const scoreResult = await query(
      "SELECT current_score FROM scores WHERE user_id = $1",
      [userId],
    );
    const score =
      scoreResult.rows.length > 0 ? scoreResult.rows[0].current_score : 500;
    const band = getCreditBand(score);

    // Fetch loan event stats for the borrower
    const statsResult = await query(
      `SELECT
         COUNT(DISTINCT loan_id) FILTER (WHERE event_type = 'LoanRequested') AS total_loans,
         COUNT(DISTINCT loan_id) FILTER (WHERE event_type = 'LoanRepaid') AS repaid_count,
         COUNT(DISTINCT loan_id) FILTER (WHERE event_type = 'LoanDefaulted') AS defaulted_count,
         COALESCE(SUM(CASE WHEN event_type = 'LoanRepaid' THEN CAST(amount AS NUMERIC) ELSE 0 END), 0) AS total_repaid
       FROM loan_events
       WHERE borrower = $1`,
      [userId],
    );

    const stats = statsResult.rows[0] || {};
    const totalLoans = parseInt(stats.total_loans || "0", 10);
    const repaidCount = parseInt(stats.repaid_count || "0", 10);
    const defaultedCount = parseInt(stats.defaulted_count || "0", 10);
    const totalRepaid = parseFloat(stats.total_repaid || "0");

    // Determine on-time vs late repayments by checking if repaid before term expiry
    const repaymentTimingResult = await query(
      `WITH approved AS (
         SELECT loan_id, MAX(ledger) AS approved_ledger,
                MAX(COALESCE(term_ledgers, 17280)) AS term_ledgers
         FROM loan_events
         WHERE event_type = 'LoanApproved' AND borrower = $1 AND loan_id IS NOT NULL
         GROUP BY loan_id
       ),
       repaid AS (
         SELECT loan_id, MIN(ledger) AS repaid_ledger
         FROM loan_events
         WHERE event_type = 'LoanRepaid' AND borrower = $1 AND loan_id IS NOT NULL
         GROUP BY loan_id
       )
       SELECT
         COUNT(*) FILTER (WHERE r.repaid_ledger <= a.approved_ledger + a.term_ledgers) AS on_time,
         COUNT(*) FILTER (WHERE r.repaid_ledger > a.approved_ledger + a.term_ledgers) AS late
       FROM repaid r
       JOIN approved a ON a.loan_id = r.loan_id`,
      [userId],
    );

    const timing = repaymentTimingResult.rows[0] || {};
    const repaidOnTime = parseInt(timing.on_time || "0", 10);
    const repaidLate = parseInt(timing.late || "0", 10);

    // Calculate average repayment time (in ledgers, converted to approx days)
    const avgRepayResult = await query(
      `WITH approved AS (
         SELECT loan_id, MAX(ledger) AS approved_ledger
         FROM loan_events
         WHERE event_type = 'LoanApproved' AND borrower = $1 AND loan_id IS NOT NULL
         GROUP BY loan_id
       ),
       repaid AS (
         SELECT loan_id, MIN(ledger) AS repaid_ledger
         FROM loan_events
         WHERE event_type = 'LoanRepaid' AND borrower = $1 AND loan_id IS NOT NULL
         GROUP BY loan_id
       )
       SELECT AVG(r.repaid_ledger - a.approved_ledger) AS avg_ledgers
       FROM repaid r
       JOIN approved a ON a.loan_id = r.loan_id`,
      [userId],
    );

    const avgLedgers = parseFloat(avgRepayResult.rows[0]?.avg_ledgers || "0");
    // Convert ledger count to approximate days (1 ledger ≈ 5 seconds)
    const avgDays = Math.round((avgLedgers * 5) / 86400);
    const averageRepaymentTime = avgLedgers > 0 ? `${avgDays} days` : "N/A";

    // Calculate repayment streaks (consecutive on-time repayments)
    const streakResult = await query(
      `WITH approved AS (
         SELECT loan_id, MAX(ledger) AS approved_ledger,
                MAX(COALESCE(term_ledgers, 17280)) AS term_ledgers
         FROM loan_events
         WHERE event_type = 'LoanApproved' AND borrower = $1 AND loan_id IS NOT NULL
         GROUP BY loan_id
       ),
       repaid AS (
         SELECT loan_id, MIN(ledger) AS repaid_ledger,
                MIN(ledger_closed_at) AS repaid_at
         FROM loan_events
         WHERE event_type = 'LoanRepaid' AND borrower = $1 AND loan_id IS NOT NULL
         GROUP BY loan_id
       ),
       timeline AS (
         SELECT r.loan_id, r.repaid_at,
                CASE WHEN r.repaid_ledger <= a.approved_ledger + a.term_ledgers THEN true ELSE false END AS on_time
         FROM repaid r
         JOIN approved a ON a.loan_id = r.loan_id
         ORDER BY r.repaid_at ASC
       )
       SELECT on_time FROM timeline ORDER BY repaid_at ASC`,
      [userId],
    );

    let longestStreak = 0;
    let currentStreak = 0;
    let tempStreak = 0;

    for (const row of streakResult.rows) {
      if (row.on_time) {
        tempStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
      } else {
        tempStreak = 0;
      }
    }
    currentStreak = tempStreak;

    // Fetch score history from score-changing events
    const historyResult = await query(
      `SELECT ledger_closed_at AS date, event_type AS event
       FROM loan_events
       WHERE borrower = $1
         AND event_type IN ('LoanRepaid', 'LoanDefaulted')
       ORDER BY ledger_closed_at ASC`,
      [userId],
    );

    // Build score history by replaying deltas from base 500
    let runningScore = 500;
    const history = historyResult.rows.map((row: Record<string, unknown>) => {
      if (row.event === "LoanRepaid") {
        runningScore = Math.min(850, runningScore + ON_TIME_DELTA);
      } else if (row.event === "LoanDefaulted") {
        runningScore = Math.max(300, runningScore - 50);
      }
      return {
        date: row.date
          ? new Date(row.date as string).toISOString().split("T")[0]
          : null,
        score: runningScore,
        event: row.event,
      };
    });

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
