import { query } from "../db/connection.js";
import logger from "../utils/logger.js";

/**
 * Apply multiple user score deltas in a single DB statement to avoid N+1
 * behavior. The `updates` map contains userId => delta (can be positive or
 * negative). We use a CTE with VALUES to insert rows for new users with an
 * initial score of 500 + delta and on conflict update by adding the delta.
 */
export async function updateUserScoresBulk(
  updates: Map<string, number>,
): Promise<void> {
  if (!updates || updates.size === 0) return;

  const params: (string | number)[] = [];
  const valuePlaceholders: string[] = [];
  let idx = 1;

  for (const [userId, delta] of updates) {
    // skip empty user ids
    if (!userId) continue;
    params.push(userId, delta);
    valuePlaceholders.push(`($${idx}, $${idx + 1})`);
    idx += 2;
  }

  if (valuePlaceholders.length === 0) return;

  const sql = `
		WITH updates (user_id, delta) AS (
			VALUES ${valuePlaceholders.join(",")}
		)
		INSERT INTO scores (user_id, current_score)
		SELECT user_id, 500 + delta FROM updates
		ON CONFLICT (user_id)
		DO UPDATE SET
			-- existing rows are incremented by delta (EXCLUDED.current_score - 500)
			current_score = LEAST(850, GREATEST(300, scores.current_score + (EXCLUDED.current_score - 500))),
			updated_at = CURRENT_TIMESTAMP
	`;

  try {
    await query(sql, params);
    logger.info("Applied bulk user score updates", {
      updatedCount: updates.size,
    });
  } catch (error) {
    logger.error("Failed to apply bulk user score updates", { error });
    throw error;
  }
}
