import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { query } from "../db/connection.js";
import { cacheService } from "../services/cacheService.js";

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

/**
 * Derive a deterministic base score from a userId so that every call to
 * getScore for the same user returns consistent data without a database.
 * Range: 500–850 (typical credit score window).
 * Deprecated - 24/03/2026
 */
function baseScore(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return 500 + (hash % 351); // [500, 850]
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
