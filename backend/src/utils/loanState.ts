import { query } from '../db/connection.js';

/**
 * Loan state lives in `contract_events`, not in a `loans` table (there is none).
 * These helpers fold a loan's lifecycle events into a single summary so
 * controllers never need to read a non-existent table.
 *
 * Derived `status` (highest precedence first):
 *   CANCELLED  - a LoanCancelled event exists
 *   REJECTED   - a LoanRejected event exists
 *   DEFAULTED  - a LoanDefaulted event exists
 *   REPAID     - at least one LoanRepaid event exists
 *   OPEN       - a LoanApproved event exists
 *   PENDING    - only a LoanRequested event exists
 * A loan with no LoanRequested/LoanApproved event does not exist (no row).
 */
export type LoanStatus = 'PENDING' | 'OPEN' | 'REPAID' | 'DEFAULTED' | 'CANCELLED' | 'REJECTED';

export interface LoanSummary {
  loan_id: number | string;
  borrower: string | null;
  status: LoanStatus;
  principal: string | null;
  approved_at: string | Date | null;
  interest_rate_bps: number | null;
  term_ledgers: number | null;
  total_repaid: string | null;
}

const LOAN_SUMMARY_SELECT = `
  SELECT
    loan_id,
    (ARRAY_AGG(address) FILTER (
      WHERE address IS NOT NULL AND event_type IN ('LoanRequested', 'LoanApproved')
    ))[1] AS borrower,
    CASE
      WHEN BOOL_OR(event_type = 'LoanCancelled') THEN 'CANCELLED'
      WHEN BOOL_OR(event_type = 'LoanRejected') THEN 'REJECTED'
      WHEN BOOL_OR(event_type = 'LoanDefaulted') THEN 'DEFAULTED'
      WHEN BOOL_OR(event_type = 'LoanRepaid') THEN 'REPAID'
      WHEN BOOL_OR(event_type = 'LoanApproved') THEN 'OPEN'
      ELSE 'PENDING'
    END AS status,
    MAX(CASE WHEN event_type = 'LoanRequested' THEN amount END)::text AS principal,
    MAX(CASE WHEN event_type = 'LoanApproved' THEN ledger_closed_at END) AS approved_at,
    MAX(CASE WHEN event_type = 'LoanApproved' THEN interest_rate_bps END) AS interest_rate_bps,
    MAX(CASE WHEN event_type = 'LoanApproved' THEN term_ledgers END) AS term_ledgers,
    COALESCE(SUM(CASE WHEN event_type = 'LoanRepaid' THEN amount::numeric END), 0)::text AS total_repaid
  FROM contract_events
  WHERE loan_id = $1
  GROUP BY loan_id
  HAVING BOOL_OR(event_type IN ('LoanRequested', 'LoanApproved'))
`;

/**
 * Returns the derived summary for a loan, or `null` when no such loan exists.
 */
export async function getLoanSummary(loanId: string | number): Promise<LoanSummary | null> {
  const result = await query(LOAN_SUMMARY_SELECT, [loanId]);
  return (result.rows[0] as LoanSummary | undefined) ?? null;
}
