/**
 * Cross-layer money policy — frontend implementation.
 *
 * This module is the *only* sanctioned place in the frontend to format or
 * parse a stroop-denominated (`bigint`) amount. It mirrors
 * `contracts/money/src/lib.rs` (`round_div`) and `backend/src/money/decimal.ts`
 * (`roundDiv`) instruction-for-instruction so a displayed amount always
 * agrees with the settlement amount at full stroop precision — no `Number`
 * division is used anywhere in this file.
 *
 * Note: bigint literal syntax (`0n`) is deliberately avoided throughout this
 * file in favor of `BigInt(0)` — the frontend's `tsconfig.json` targets
 * ES2017, and `tsc` rejects BigInt literals below ES2020 even though Node
 * itself would happily run them.
 *
 * See `/money-policy.json` for the single source of truth this module
 * derives its constants from (via `scripts/gen-money.ts` ->
 * `policy.generated.ts`).
 */
import { SCALE, SCALE_DECIMALS, MODE, DISPLAY_DP } from "./policy.generated";

const ZERO = BigInt(0);
const TWO = BigInt(2);
const TEN = BigInt(10);

/** Rounding strategy applied by {@link roundDiv} to a nonzero remainder. */
export enum RoundingMode {
  /** Round to the nearest value; ties round to the nearest even quotient. */
  HalfEven = "half_even",
  /** Round to the nearest value; ties round away from zero. */
  HalfUp = "half_up",
  /** Always round toward negative infinity. */
  Floor = "floor",
  /** Always round toward positive infinity. */
  Ceil = "ceil",
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Number of stroops in one whole unit of the settlement asset (`10^7`). */
export const STROOP_SCALE = SCALE;
/** Decimal places backing {@link STROOP_SCALE}. */
export const STROOP_DECIMALS = SCALE_DECIMALS;
/** Default rounding mode every layer agrees on for settlement math. */
export const DEFAULT_MODE = MODE as RoundingMode;
/** Fractional digits used for *display only* — settlement always uses {@link STROOP_DECIMALS}. */
export const DISPLAY_DECIMAL_PLACES = DISPLAY_DP;

/** Divide `num` by `den`, applying `mode` to any remainder. No `Number` involved. */
export function roundDiv(num: bigint, den: bigint, mode: RoundingMode = DEFAULT_MODE): bigint {
  if (den === ZERO) {
    throw new MoneyError("division by zero");
  }

  let n = num;
  let d = den;
  if (d < ZERO) {
    n = -n;
    d = -d;
  }

  const quotient = n / d;
  const remainder = n % d;
  if (remainder === ZERO) {
    return quotient;
  }

  const remainderIsNegative = remainder < ZERO;
  const absRemainder = remainderIsNegative ? -remainder : remainder;

  let roundAwayFromZero: boolean;
  switch (mode) {
    case RoundingMode.Floor:
      roundAwayFromZero = remainderIsNegative;
      break;
    case RoundingMode.Ceil:
      roundAwayFromZero = !remainderIsNegative;
      break;
    case RoundingMode.HalfUp:
      roundAwayFromZero = absRemainder * TWO >= d;
      break;
    case RoundingMode.HalfEven: {
      const doubled = absRemainder * TWO;
      if (doubled > d) {
        roundAwayFromZero = true;
      } else if (doubled < d) {
        roundAwayFromZero = false;
      } else {
        roundAwayFromZero = quotient % TWO !== ZERO;
      }
      break;
    }
    default:
      throw new MoneyError(`unknown rounding mode: ${String(mode)}`);
  }

  if (!roundAwayFromZero) {
    return quotient;
  }
  return remainderIsNegative ? quotient - BigInt(1) : quotient + BigInt(1);
}

export interface FormatStroopsOptions {
  /** Fractional digits to display. Defaults to the policy's `display_dp` (2). */
  decimalPlaces?: number;
  /** Rounding mode used when truncating to `decimalPlaces`. Defaults to the policy mode. */
  mode?: RoundingMode;
  /** Include thousands separators via `toLocaleString`-style grouping. Default `false`. */
  grouped?: boolean;
  locale?: string;
}

/**
 * Format an exact stroop amount as a decimal string for display.
 *
 * Settlement precision ({@link STROOP_DECIMALS}) is never exceeded internally
 * — this only *truncates for presentation* using the policy's rounding mode,
 * it never mutates the underlying settlement value. Pass the returned string
 * to a UI label; never feed it back into a transaction (use
 * {@link parseAmount} on the original user input for that).
 */
export function formatStroops(value: bigint, opts: FormatStroopsOptions = {}): string {
  const decimalPlaces = opts.decimalPlaces ?? DISPLAY_DECIMAL_PLACES;
  const mode = opts.mode ?? DEFAULT_MODE;

  if (decimalPlaces < 0) {
    throw new MoneyError("decimalPlaces must be non-negative");
  }

  const negative = value < ZERO;
  const magnitude = negative ? -value : value;

  // Rescale from stroop precision (STROOP_DECIMALS) down to the requested
  // display precision using the same round_div every other layer uses.
  let scaledMagnitude: bigint;
  if (decimalPlaces >= STROOP_DECIMALS) {
    scaledMagnitude = magnitude * TEN ** BigInt(decimalPlaces - STROOP_DECIMALS);
  } else {
    const den = TEN ** BigInt(STROOP_DECIMALS - decimalPlaces);
    scaledMagnitude = roundDiv(magnitude, den, mode);
  }

  const scale = TEN ** BigInt(decimalPlaces);
  const whole = scaledMagnitude / scale;
  const fraction = scaledMagnitude % scale;

  const wholeStr =
    (opts.grouped ?? false) ? whole.toLocaleString(opts.locale ?? "en-US") : whole.toString();

  const sign = negative && scaledMagnitude !== ZERO ? "-" : "";

  if (decimalPlaces === 0) {
    return `${sign}${wholeStr}`;
  }

  return `${sign}${wholeStr}.${fraction.toString().padStart(decimalPlaces, "0")}`;
}

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

/**
 * Parse a human-entered decimal amount (e.g. `"12.5"`) into stroops at full
 * settlement precision. Throws {@link MoneyError} on malformed input.
 *
 * `parseAmount(formatStroops(x))` round-trips to `x` whenever `x` is exactly
 * representable at the configured display precision; for values with more
 * fractional detail than `display_dp`, always keep the original raw stroop
 * amount around for settlement and use this function only on fresh user
 * input, never on an already-truncated display string.
 */
export function parseAmount(text: string, mode: RoundingMode = DEFAULT_MODE): bigint {
  const trimmed = text.trim().replace(/,/g, "");
  if (!DECIMAL_STRING.test(trimmed)) {
    throw new MoneyError(`invalid decimal amount: ${JSON.stringify(text)}`);
  }

  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [wholeRaw, fractionRaw = ""] = unsigned.split(".");
  const whole = wholeRaw && wholeRaw.length > 0 ? wholeRaw : "0";

  let magnitude: bigint;
  if (fractionRaw.length <= STROOP_DECIMALS) {
    const paddedFraction = fractionRaw.padEnd(STROOP_DECIMALS, "0");
    magnitude = BigInt(whole) * STROOP_SCALE + BigInt(paddedFraction || "0");
  } else {
    const extraDigits = fractionRaw.length - STROOP_DECIMALS;
    const den = TEN ** BigInt(extraDigits);
    const num = BigInt(whole) * TEN ** BigInt(fractionRaw.length) + BigInt(fractionRaw);
    magnitude = roundDiv(num, den, mode);
  }

  return negative ? -magnitude : magnitude;
}
