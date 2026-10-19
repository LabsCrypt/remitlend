/**
 * Filter normalization for the remittances list (#1881).
 *
 * The page holds its filter inputs as raw strings, because that is what a
 * controlled `<input>` needs. The API needs query params. These helpers are
 * the seam between the two, and they are pure so the edge cases can be tested
 * without rendering the page.
 */

import type { CursorListParams } from "../hooks/useApi";

export interface RemittanceFilterInput {
  searchQuery: string;
  /** `YYYY-MM-DD` from `<input type="date">`, or "". */
  dateFrom: string;
  dateTo: string;
  /** Raw text from `<input type="number">`, or "". */
  minAmount: string;
  maxAmount: string;
}

const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Latest instant representable in a `YYYY-MM-DD` day, in UTC. */
const END_OF_DAY_SUFFIX = "T23:59:59.999Z";
/** Earliest instant of a `YYYY-MM-DD` day, in UTC. */
const START_OF_DAY_SUFFIX = "T00:00:00.000Z";

/**
 * A number input can still hand us junk: `""` while typing, `"-"`, `"1e"`,
 * or anything non-finite. Those must all mean "no bound" rather than becoming
 * `NaN` and quietly emptying the list.
 *
 * `Number()` rather than `Number.parseFloat()`: parseFloat stops at the first
 * invalid character, so `"1e"` — a user mid-typing scientific notation —
 * parses as `1` and would silently become `amount >= 1`. `Number()` rejects
 * the whole string. The empty check is done first precisely because
 * `Number("")` is `0`, which would turn a blank field into a real filter.
 */
function parseAmount(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

/**
 * Expands a `YYYY-MM-DD` bound to a full ISO instant.
 *
 * The upper bound matters: `Date.parse("2026-01-15")` is midnight *starting*
 * that day, and the API filters `created_at <= to`. Passing the raw date
 * would silently exclude every remittance sent on the day the user picked.
 * A value that is already a full ISO timestamp is passed through untouched.
 */
function toIsoInstant(value: string, endOfDay: boolean): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (!ISO_DATE_ONLY.test(trimmed)) {
    return Number.isNaN(Date.parse(trimmed)) ? undefined : trimmed;
  }
  return `${trimmed}${endOfDay ? END_OF_DAY_SUFFIX : START_OF_DAY_SUFFIX}`;
}

export interface NormalizedRemittanceFilters {
  q?: string;
  from?: string;
  to?: string;
  minAmount?: number;
  maxAmount?: number;
}

/**
 * Turns raw input state into request params, dropping anything unset.
 *
 * A search term is trimmed and capped at the API's 255-char limit rather than
 * being sent long enough to be rejected with a 400.
 */
export function normalizeRemittanceFilters(
  input: RemittanceFilterInput,
): NormalizedRemittanceFilters {
  const q = input.searchQuery.trim().slice(0, 255);
  const from = toIsoInstant(input.dateFrom, false);
  const to = toIsoInstant(input.dateTo, true);
  const minAmount = parseAmount(input.minAmount);
  const maxAmount = parseAmount(input.maxAmount);

  return {
    ...(q ? { q } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(minAmount !== undefined ? { minAmount } : {}),
    ...(maxAmount !== undefined ? { maxAmount } : {}),
  };
}

/**
 * True when the filters describe something other than "no filtering".
 *
 * Drives the "no results match" copy, so a user who typed something and got
 * nothing is told to clear the filters, while a user with no filters set is
 * told there is simply nothing here.
 */
export function hasActiveRemittanceFilters(input: RemittanceFilterInput): boolean {
  return Object.keys(normalizeRemittanceFilters(input)).length > 0;
}

/** Merges normalized filters into the params for `useRemittancesPage`. */
export function withRemittanceFilters(
  base: CursorListParams,
  input: RemittanceFilterInput,
): CursorListParams {
  return { ...base, ...normalizeRemittanceFilters(input) };
}
