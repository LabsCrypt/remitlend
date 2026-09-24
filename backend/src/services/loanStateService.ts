import { query } from '../db/connection.js';

/**
 * Loan status derived exclusively from the indexed `contract_events` stream.
 *
 * The PostgreSQL schema has no `loans` table: loan state is a projection over
 * the events emitted by the loan manager contract (`LoanRequested`,
 * `LoanApproved`, `LoanRepaid`, `LoanDefaulted`, `LoanCancelled`,
 * `LoanRejected`, ...). These values preserve the status vocabulary the loan
 * build endpoints have always returned.
 */
export type DerivedLoanStatus =
  | 'PENDING'
  | 'OPEN'
  | 'COMPLETED'
  | 'DEFAULTED'
  | 'CANCELLED'
  | 'REJECTED';

export interface DerivedLoanState {
  loanId: number;
  /** Borrower / owner address taken from the indexed events. */
  address: string | null;
  /** Principal requested in stroops, when a `LoanRequested` event exists. */
  principal: number | null;
  /** Cumulative amount of every `LoanRepaid` event, in stroops. */
  totalRepaid: number;
  approvedAt: string | null;
  approvedLedger: number | null;
  interestRateBps: number | null;
  termLedgers: number | null;
  latestEventType: string | null;
  status: DerivedLoanStatus;
}

const toNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

const toIsoString = (value: unknown): string | null =>
  value === null || value === undefined ? null : new Date(value as string).toISOString();

/**
 * A default is sticky unless a `DefaultReversed` event (written when an admin
 * reverses a dispute) landed at or after the `LoanDefaulted` event.
 */
const isCurrentlyDefaulted = (defaultedAt: unknown, reversedAt: unknown): boolean => {
  if (defaultedAt === null || defaultedAt === undefined) return false;
  if (reversedAt === null || reversedAt === undefined) return true;
  return (
    new Date(reversedAt as string).getTime() <= new Date(defaultedAt as string).getTime()
  );
};

/**
 * Loads a loan's current state by aggregating every indexed event with that
 * `loan_id`. Returns `null` when no events exist (i.e. the loan is unknown).
 */
export async function getLoanState(
  loanId: string | number,
): Promise<DerivedLoanState | null> {
  const result = await query(
    `
    SELECT
      loan_id,
      MAX(address) AS address,
      MAX(CASE WHEN event_type = 'LoanRequested' THEN amount::numeric END) AS principal,
      MAX(CASE WHEN event_type = 'LoanApproved' THEN ledger_closed_at END) AS approved_at,
      MAX(CASE WHEN event_type = 'LoanApproved' THEN ledger END) AS approved_ledger,
      MAX(CASE WHEN event_type = 'LoanApproved' THEN interest_rate_bps END) AS interest_rate_bps,
      MAX(CASE WHEN event_type = 'LoanApproved' THEN term_ledgers END) AS term_ledgers,
      COALESCE(SUM(CASE WHEN event_type = 'LoanRepaid' THEN amount::numeric ELSE 0 END), 0)
        AS total_repaid,
      BOOL_OR(event_type = 'LoanApproved') AS is_approved,
      BOOL_OR(event_type = 'LoanCancelled') AS is_cancelled,
      BOOL_OR(event_type = 'LoanRejected') AS is_rejected,
      MAX(CASE WHEN event_type = 'LoanDefaulted' THEN ledger_closed_at END) AS defaulted_at,
      MAX(CASE WHEN event_type = 'DefaultReversed' THEN ledger_closed_at END) AS default_reversed_at,
      (ARRAY_AGG(event_type ORDER BY COALESCE(ledger, 0) DESC, ledger_closed_at DESC, id DESC))[1]
        AS latest_event_type
    FROM contract_events
    WHERE loan_id = $1
    GROUP BY loan_id
    `,
    [loanId],
  );

  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  const principal = toNumber(row.principal);
  const totalRepaid = toNumber(row.total_repaid) ?? 0;

  let status: DerivedLoanStatus;
  if (row.is_cancelled === true) {
    status = 'CANCELLED';
  } else if (row.is_rejected === true) {
    status = 'REJECTED';
  } else if (isCurrentlyDefaulted(row.defaulted_at, row.default_reversed_at)) {
    status = 'DEFAULTED';
  } else if (row.is_approved !== true) {
    status = 'PENDING';
  } else if (principal !== null && totalRepaid >= principal) {
    status = 'COMPLETED';
  } else {
    status = 'OPEN';
  }

  return {
    loanId: Number(row.loan_id ?? loanId),
    address: (row.address as string | null) ?? null,
    principal,
    totalRepaid,
    approvedAt: toIsoString(row.approved_at),
    approvedLedger: toNumber(row.approved_ledger),
    interestRateBps: toNumber(row.interest_rate_bps),
    termLedgers: toNumber(row.term_ledgers),
    latestEventType: (row.latest_event_type as string | null) ?? null,
    status,
  };
}
