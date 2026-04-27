import { query } from "../db/connection.js";
import logger from "../utils/logger.js";

/**
 * Apply multiple user score deltas. The `updates` map contains userId => delta
 * (can be positive or negative). All user updates are inserted in a single
 * query for efficiency.
 */
export async function updateUserScoresBulk(
  updates: Map<string, number>,
): Promise<void> {
  if (!updates || updates.size === 0) return;

  const params: (string | number)[] = [];

  for (const [userId, delta] of updates) {
    // skip empty user ids
    if (!userId) continue;
    params.push(userId, delta);
  }

  if (params.length === 0) return;

  try {
    const valuePlaceholders = Array.from(
      { length: params.length / 2 },
      (_, i) => `($${i * 2 + 1}, 500 + $${i * 2 + 2})`,
    ).join(", ");

    await query(
      `INSERT INTO scores (user_id, current_score)
       VALUES ${valuePlaceholders}
       ON CONFLICT (user_id)
       DO UPDATE SET
         current_score = LEAST(850, GREATEST(300, scores.current_score + EXCLUDED.current_score - 500)),
         updated_at = CURRENT_TIMESTAMP`,
      params,
    );
    logger.info("Applied bulk user score updates", {
      updatedCount: params.length / 2,
    });
  } catch (error) {
    logger.error("Failed to apply bulk user score updates", { error });
    throw error;
  }
}

/**
 * Set multiple user scores to authoritative absolute values in a single query.
 * Used by reconciliation paths where on-chain state should overwrite DB state.
 */
export async function setAbsoluteUserScoresBulk(
  scores: Map<string, number>,
): Promise<void> {
  if (!scores || scores.size === 0) return;

  const params: (string | number)[] = [];
  const valuePlaceholders: string[] = [];
  let idx = 1;

  for (const [userId, score] of scores) {
    if (!userId) continue;
    params.push(userId, score);
    valuePlaceholders.push(`($${idx}, $${idx + 1})`);
    idx += 2;
  }

  if (valuePlaceholders.length === 0) return;

  const sql = `
    WITH reconciled_scores (user_id, current_score) AS (
      VALUES ${valuePlaceholders.join(",")}
    )
    INSERT INTO scores (user_id, current_score)
    SELECT user_id, current_score FROM reconciled_scores
    ON CONFLICT (user_id)
    DO UPDATE SET
      current_score = EXCLUDED.current_score,
      updated_at = CURRENT_TIMESTAMP
  `;

  try {
    await query(sql, params);
    logger.info("Applied absolute user score reconciliation updates", {
      updatedCount: valuePlaceholders.length,
    });
  } catch (error) {
    logger.error("Failed to apply absolute user score reconciliation updates", {
      error,
    });
    throw error;
  }
}
