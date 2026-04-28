// Service for score decay logic
// Provides functions to find inactive borrowers and apply score decay

import { query } from "../db/connection.js";

const DECAY_PER_MONTH = 5;
const MIN_SCORE = 300; // Adjust as needed

// Get borrowers who have not repaid in the last month
export async function getInactiveBorrowers() {
  // Example: select borrowers whose last repayment is > 1 month ago
  const result = await query(`
    SELECT b.id, b.score, MAX(e.ledger_closed_at) AS last_repayment
    FROM borrowers b
    LEFT JOIN loan_events e ON b.id = e.borrower AND e.event_type = 'LoanRepaid'
    GROUP BY b.id, b.score
    HAVING MAX(e.ledger_closed_at) IS NULL OR MAX(e.ledger_closed_at) < NOW() - INTERVAL '1 month'
  `);
  return result.rows;
}

// Apply score decay to a borrower based on inactivity
export async function applyScoreDecay(borrower: {
  id: string;
  score: number;
  last_repayment: string | null;
}) {
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
  await query(`UPDATE borrowers SET score = $1 WHERE id = $2`, [
    newScore,
    borrower.id,
  ]);
  return newScore;
}
