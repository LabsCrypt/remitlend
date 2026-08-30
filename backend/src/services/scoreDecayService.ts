// Service for score decay logic
// Provides functions to find inactive borrowers and apply score decay

import { query } from '../db/connection.js';

const DECAY_PER_MONTH = 5;
const MIN_SCORE = 300; // Adjust as needed

export interface InactiveBorrower {
  borrower: string;
  score: number;
  last_repayment: string | null;
}

// Get borrowers who have not repaid in the last month
export async function getInactiveBorrowers(): Promise<InactiveBorrower[]> {
  const result = await query(`
    SELECT s.user_id AS borrower, s.current_score AS score, MAX(e.ledger_closed_at) AS last_repayment
    FROM scores s
    LEFT JOIN contract_events e ON s.user_id = e.address AND e.event_type = 'LoanRepaid'
    GROUP BY s.user_id, s.current_score
    HAVING MAX(e.ledger_closed_at) IS NULL OR MAX(e.ledger_closed_at) < NOW() - INTERVAL '1 month'
  `);
  return result.rows as InactiveBorrower[];
}

// Apply score decay to a borrower based on inactivity
export async function applyScoreDecay(borrower: InactiveBorrower) {
  const lastRepayment = borrower.last_repayment;
  const now = new Date();
  let monthsInactive = 1;
  if (lastRepayment) {
    const last = new Date(lastRepayment);
    monthsInactive = Math.max(
      1,
      Math.floor((now.getTime() - last.getTime()) / (30 * 24 * 60 * 60 * 1000)),
    );
  }
  const decay = monthsInactive * DECAY_PER_MONTH;
  const newScore = Math.max(MIN_SCORE, borrower.score - decay);
  await query(
    `UPDATE scores SET current_score = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`,
    [newScore, borrower.borrower],
  );
  return newScore;
}
