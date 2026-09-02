/**
 * Accrued-interest math for backend loan views (issue #1600).
 *
 * The loan manager contract accrues interest on the *remaining* principal
 * (`loan.amount - loan.principal_paid`, see `accrue_interest` in
 * `contracts/loan_manager/src/lib.rs`), not on the originally approved
 * amount. The backend's event store records each `LoanRepaid` event as a
 * single total amount (the contract publishes one amount; the
 * principal/interest split is contract-internal state), so the
 * principal-repayment signal available from `contract_events` is the
 * cumulative repaid total. Both loan endpoints therefore accrue interest on
 * `max(0, principal - totalRepaid)` — the issue's "remaining unpaid
 * principal" — using exact integer stroop arithmetic routed through the
 * shared money policy (`roundDiv` / `RoundingMode`), so the list and detail
 * endpoints agree with each other and no float drift accumulates.
 *
 * All amounts are integer stroop counts (the unit `contract_events.amount`
 * is stored in, mirroring `contracts/money`); callers convert to display
 * units at the API boundary.
 */
import { roundDiv, RoundingMode, MoneyError } from './decimal.js';

/**
 * Parse a `contract_events.amount` value into a bigint stroop count.
 *
 * The column is Postgres `NUMERIC` and can format an integer stroop count
 * with an all-zero fractional part (e.g. `150.0`), so accept that but reject
 * any genuinely fractional stroop amount rather than silently truncating
 * it.
 */
export function parseStroopAmount(raw: string | null | undefined): bigint {
  if (!raw) return 0n;
  const [wholeRaw, fraction = ''] = raw.split('.');
  const whole = wholeRaw && wholeRaw.length > 0 ? wholeRaw : '0';
  if (fraction.length > 0 && /[1-9]/.test(fraction)) {
    throw new MoneyError(`amount must be an integer stroop count, got "${raw}"`);
  }
  return BigInt(whole);
}

/**
 * Remaining unpaid principal (`principal - repaid`), floored at zero once
 * the loan is fully repaid so accrual never goes negative.
 */
export function remainingPrincipal(principalStroops: bigint, totalRepaidStroops: bigint): bigint {
  return principalStroops > totalRepaidStroops ? principalStroops - totalRepaidStroops : 0n;
}

/**
 * Simple interest accrued on `remainingPrincipalStroops` over
 * `elapsedLedgers` at `interestRateBps` across `termLedgers`, floored to a
 * whole stroop count.
 *
 * Mirrors the contract's `accrue_interest` formula in
 * `contracts/loan_manager/src/lib.rs`:
 *
 *   remaining_principal * rate_bps * elapsed_ledgers / (10_000 * term_ledgers)
 *
 * (The contract evaluates that numerator at 1e6 intermediate precision and
 * carries the fractional remainder forward as `interest_residual`; the
 * floored integer result here is identical for display purposes, since the
 * residual is at most one stroop and never rounds a value up.)
 */
export function accrueInterest(params: {
  remainingPrincipalStroops: bigint;
  interestRateBps: number;
  elapsedLedgers: number;
  termLedgers: number;
}): bigint {
  const { remainingPrincipalStroops, interestRateBps, elapsedLedgers, termLedgers } = params;
  if (
    remainingPrincipalStroops <= 0n ||
    interestRateBps <= 0 ||
    elapsedLedgers <= 0 ||
    termLedgers <= 0
  ) {
    return 0n;
  }
  const numerator = remainingPrincipalStroops * BigInt(interestRateBps) * BigInt(elapsedLedgers);
  const denominator = 10_000n * BigInt(termLedgers);
  return roundDiv(numerator, denominator, RoundingMode.Floor);
}
