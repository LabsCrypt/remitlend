// Service for score decay logic
// Provides functions to find inactive borrowers and apply score decay

import { query } from '../db/connection.js';
import { SCORES_TABLE } from '../db/scoresTable.js';

const DECAY_PER_MONTH = 5;
const MIN_SCORE = 300; // Adjust as needed
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export interface InactiveBorrower {
  borrower: string;
  score: number;
  last_activity: string | null;
  last_decayed_at?: string | null;
}

// Only score users with an actual loan history. Account registration alone is
// not evidence of inactivity and must not trigger repeated score decay.
export async function getInactiveBorrowers(): Promise<InactiveBorrower[]> {
  const result = await query(`
    SELECT s.${SCORES_TABLE.columns.borrower} AS borrower, s.${SCORES_TABLE.columns.score} AS score, s.${SCORES_TABLE.columns.lastDecayedAt}, MAX(e.ledger_closed_at) AS last_activity
    FROM ${SCORES_TABLE.tableName} s
    JOIN contract_events e
      ON e.address = s.${SCORES_TABLE.columns.borrower}
      AND e.event_type IN ('LoanApproved', 'LoanRepaid')
    GROUP BY s.${SCORES_TABLE.columns.borrower}, s.${SCORES_TABLE.columns.score}, s.${SCORES_TABLE.columns.lastDecayedAt}
    HAVING MAX(e.ledger_closed_at) < NOW() - INTERVAL '1 month'
  `);
  return result.rows as InactiveBorrower[];
}

// Apply score decay to a borrower based on inactivity, idempotently against last_decayed_at
export async function applyScoreDecay(borrower: InactiveBorrower) {
  const lastActivity = borrower.last_activity;
  if (!lastActivity) return borrower.score;

  const now = new Date();
  const last = new Date(lastActivity);
  const totalMonthsInactive = Math.floor((now.getTime() - last.getTime()) / MONTH_MS);
  if (!Number.isFinite(last.getTime()) || totalMonthsInactive < 1) return borrower.score;

  let alreadyDecayedMonths = 0;
  if (borrower.last_decayed_at) {
    const lastDecayed = new Date(borrower.last_decayed_at);
    if (Number.isFinite(lastDecayed.getTime()) && lastDecayed.getTime() > last.getTime()) {
      alreadyDecayedMonths = Math.floor((lastDecayed.getTime() - last.getTime()) / MONTH_MS);
    }
  }

  const monthsToDecay = totalMonthsInactive - alreadyDecayedMonths;
  if (monthsToDecay <= 0) return borrower.score;

  const decay = monthsToDecay * DECAY_PER_MONTH;
  const newScore = Math.max(MIN_SCORE, borrower.score - decay);
  await query(
    `UPDATE ${SCORES_TABLE.tableName} SET ${SCORES_TABLE.columns.score} = $1, ${SCORES_TABLE.columns.lastDecayedAt} = $2, ${SCORES_TABLE.columns.updatedAt} = CURRENT_TIMESTAMP WHERE ${SCORES_TABLE.columns.borrower} = $3`,
    [newScore, now.toISOString(), borrower.borrower],
  );
  return newScore;
}
