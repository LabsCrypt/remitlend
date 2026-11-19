/** Shared formatting utilities for borrower loan components. */

import { formatStroops } from "../../../../lib/money/format";

/**
 * Format a plain decimal USD amount for display using the shared money policy.
 * Routes through lib/money/format so DISPLAY_DP and rounding stay consistent
 * across every consumer — no ad-hoc Intl.NumberFormat("en-US") calls.
 *
 * @param amount  Decimal number (e.g. 12.5 for $12.50).
 * @param locale  BCP 47 locale tag from useLocale(). Defaults to "en".
 * @param options Optional overrides forwarded to formatStroops.
 */
export function formatCurrency(
  amount: number,
  locale = "en",
  options: { grouped?: boolean; decimalPlaces?: number } = {},
): string {
  // Convert the decimal number to stroops (integer, 7 dp) so formatStroops
  // can apply the policy-mandated rounding and grouping.
  const STROOP_SCALE = 10_000_000;
  const stroops = BigInt(Math.round(amount * STROOP_SCALE));
  const formatted = formatStroops(stroops, {
    grouped: options.grouped ?? true,
    locale,
    decimalPlaces: options.decimalPlaces,
  });
  return `$${formatted}`;
}

/**
 * Like formatCurrency but returns the numeric string without the leading "$".
 * Use this wherever a bare number is needed (e.g. input placeholders, aria
 * labels). Replaces the previous `.replace("$", "")` hack.
 */
export function formatCurrencyNoSymbol(
  amount: number,
  locale = "en",
  options: { grouped?: boolean; decimalPlaces?: number } = {},
): string {
  return formatCurrency(amount, locale, options).replace(/^\$/, "");
}

export { formatDate } from "../../utils/date";

export function getDaysUntilDeadline(deadline: string): number {
  const msUntil = new Date(deadline).getTime() - Date.now();
  const days = Math.ceil(msUntil / (1000 * 60 * 60 * 24));
  // Math.ceil maps small negative fractions (e.g. -0.2 for 5h overdue) to -0,
  // which equals 0 and hides sub-24h-overdue deadlines from `daysUntil < 0` checks.
  return msUntil < 0 && days === 0 ? -1 : days;
}
