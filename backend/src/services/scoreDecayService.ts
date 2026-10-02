// Service for score decay logic
// Provides functions to find inactive borrowers and apply score decay

import { query } from '../db/connection.js';

const DECAY_PER_MONTH = 5;
const MIN_SCORE = 300; // Adjust as needed

export interface InactiveBorrower {
  borrower: string;
  score: number;
  last_activity: string | null;
}

// Only score users with an actual loan history. Account registration alone is
// not evidence of inactivity and must not trigger repeated score decay.
export async function getInactiveBorrowers(): Promise<InactiveBorrower[]> {
  const result = await query(`
    SELECT s.user_id AS borrower, s.current_score AS score, MAX(e.ledger_closed_at) AS last_activity
    FROM scores s
    JOIN contract_events e
      ON e.address = s.user_id
      AND e.event_type IN ('LoanApproved', 'LoanRepaid')
    GROUP BY s.user_id, s.current_score
    HAVING MAX(e.ledger_closed_at) < NOW() - INTERVAL '1 month'
  `);
  return result.rows as InactiveBorrower[];
}

// Apply score decay to a borrower based on inactivity
export async function applyScoreDecay(borrower: InactiveBorrower) {
  const lastActivity = borrower.last_activity;
  if (!lastActivity) return borrower.score;

  const now = new Date();
  const last = new Date(lastActivity);
  const monthsInactive = Math.floor((now.getTime() - last.getTime()) / (30 * 24 * 60 * 60 * 1000));
  if (!Number.isFinite(last.getTime()) || monthsInactive < 1) return borrower.score;

  const decay = monthsInactive * DECAY_PER_MONTH;
  const newScore = Math.max(MIN_SCORE, borrower.score - decay);
  await query(
    `UPDATE scores SET current_score = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`,
    [newScore, borrower.borrower],
  );
  return newScore;
}
