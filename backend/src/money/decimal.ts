/**
 * Cross-layer money policy — backend implementation.
 *
 * This module is the *only* sanctioned place in the backend to divide, round
 * or split a stroop-denominated (`bigint`) amount. Every service that reads
 * a settlement amount from the chain, the database, or an API payload must
 * route conversions through here instead of using `Number`/float math, so
 * that owed-vs-paid comparisons agree with the on-chain `money` crate
 * (`contracts/money/src/lib.rs`) and the frontend's `format.ts` bit-for-bit.
 *
 * See `/money-policy.json` for the single source of truth this module
 * derives its constants from (via `scripts/gen-money.ts` ->
 * `policy.generated.ts`).
 */
import { SCALE, SCALE_DECIMALS, MODE, DISPLAY_DP } from './policy.generated.js';

/** Rounding strategy applied by {@link roundDiv} to a nonzero remainder. */
export enum RoundingMode {
  /** Round to the nearest value; ties round to the nearest even quotient. */
  HalfEven = 'half_even',
  /** Round to the nearest value; ties round away from zero. */
  HalfUp = 'half_up',
  /** Always round toward negative infinity. */
  Floor = 'floor',
  /** Always round toward positive infinity. */
  Ceil = 'ceil',
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
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

/**
 * Divide `num` by `den`, applying `mode` to any remainder.
 *
 * This mirrors `money::round_div` in `contracts/money/src/lib.rs`
 * instruction-for-instruction (same normalization, same tie-break rule for
 * `HalfEven`) so the two implementations agree on every input.
 */
export function roundDiv(num: bigint, den: bigint, mode: RoundingMode = DEFAULT_MODE): bigint {
  if (den === 0n) {
    throw new MoneyError('division by zero');
  }

  // Normalize so `den` is always positive; fold its sign into `num`.
  let n = num;
  let d = den;
  if (d < 0n) {
    n = -n;
    d = -d;
  }

  const quotient = n / d; // bigint division truncates toward zero, like i128.
  const remainder = n % d;

  if (remainder === 0n) {
    return quotient;
  }

  const remainderIsNegative = remainder < 0n;
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
      roundAwayFromZero = absRemainder * 2n >= d;
      break;
    case RoundingMode.HalfEven: {
      const doubled = absRemainder * 2n;
      if (doubled > d) {
        roundAwayFromZero = true;
      } else if (doubled < d) {
        roundAwayFromZero = false;
      } else {
        // Exact tie: round to even.
        roundAwayFromZero = quotient % 2n !== 0n;
      }
      break;
    }
    default:
      throw new MoneyError(`unknown rounding mode: ${String(mode)}`);
  }

  if (!roundAwayFromZero) {
    return quotient;
  }
  return remainderIsNegative ? quotient - 1n : quotient + 1n;
}

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

/**
 * Parse a human-entered decimal amount (e.g. `"12.5"`) into stroops.
 *
 * Throws {@link MoneyError} on malformed input. Fractional input with more
 * than {@link STROOP_DECIMALS} digits is rounded per `mode` rather than
 * truncated, so a value typed with excess precision still settles
 * consistently instead of silently losing sub-stroop dust.
 */
export function toStroops(input: string, mode: RoundingMode = DEFAULT_MODE): bigint {
  const trimmed = input.trim();
  if (!DECIMAL_STRING.test(trimmed)) {
    throw new MoneyError(`invalid decimal amount: ${JSON.stringify(input)}`);
  }

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [wholeRaw, fractionRaw = ''] = unsigned.split('.');
  const whole = wholeRaw && wholeRaw.length > 0 ? wholeRaw : '0';

  let magnitude: bigint;
  if (fractionRaw.length <= STROOP_DECIMALS) {
    const paddedFraction = fractionRaw.padEnd(STROOP_DECIMALS, '0');
    magnitude = BigInt(whole) * STROOP_SCALE + BigInt(paddedFraction || '0');
  } else {
    const extraDigits = fractionRaw.length - STROOP_DECIMALS;
    const den = 10n ** BigInt(extraDigits);
    const num = BigInt(whole) * 10n ** BigInt(fractionRaw.length) + BigInt(fractionRaw);
    magnitude = roundDiv(num, den, mode);
  }

  return negative ? -magnitude : magnitude;
}

/**
 * Format an exact stroop amount as a full-precision decimal string (no
 * rounding — this is the settlement-precision representation, not the
 * display-truncated one). Inverse of {@link toStroops} for values that fit
 * exactly at stroop precision: `toStroops(fromStroops(x)) === x`.
 */
export function fromStroops(value: bigint): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / STROOP_SCALE;
  const fraction = (magnitude % STROOP_SCALE).toString().padStart(STROOP_DECIMALS, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

/**
 * Round a numeric amount to 2 decimal places (cents) using the policy's
 * default half-even rounding mode.
 */
export function roundToCents(value: number, mode: RoundingMode = DEFAULT_MODE): number {
  if (!Number.isFinite(value)) return value;
  const stroops = toStroops(value.toFixed(7), mode);
  const cents = roundDiv(stroops, 100_000n, mode);
  return Number(cents) / 100;
}

/**
 * Split `total` stroops across `weights` proportionally using the
 * largest-remainder method, guaranteeing the returned parts sum *exactly*
 * to `total`. Mirrors `money::split_pro_rata` in the contract crate:
 * floor-allocate each share, then hand out the leftover stroops one at a
 * time to the entries with the largest fractional remainder, breaking ties
 * by lowest index for determinism.
 */
export function splitProRata(total: bigint, weights: readonly bigint[]): bigint[] {
  if (total < 0n) {
    throw new MoneyError('total must be non-negative');
  }
  if (weights.length === 0) {
    if (total === 0n) return [];
    throw new MoneyError('cannot split a nonzero total across zero weights');
  }
  if (weights.some((w) => w < 0n)) {
    throw new MoneyError('weights must be non-negative');
  }

  const weightSum = weights.reduce((acc, w) => acc + w, 0n);
  if (weightSum === 0n) {
    if (total === 0n) return weights.map(() => 0n);
    throw new MoneyError('cannot split a nonzero total across zero total weight');
  }

  const parts: bigint[] = [];
  const remainders: bigint[] = [];
  let allocated = 0n;

  for (const w of weights) {
    const numerator = total * w;
    const part = roundDiv(numerator, weightSum, RoundingMode.Floor);
    parts.push(part);
    remainders.push(numerator - part * weightSum);
    allocated += part;
  }

  const leftover = total - allocated;
  if (leftover < 0n || leftover >= BigInt(weights.length)) {
    throw new MoneyError('drift detected while splitting pro-rata amounts');
  }

  const used = new Array<boolean>(weights.length).fill(false);
  let remaining = leftover;
  while (remaining > 0n) {
    let bestIdx = -1;
    let bestRemainder = -1n;
    for (let i = 0; i < remainders.length; i += 1) {
      if (used[i]) continue;
      const r = remainders[i]!;
      if (r > bestRemainder) {
        bestRemainder = r;
        bestIdx = i;
      }
    }
    parts[bestIdx] = parts[bestIdx]! + 1n;
    used[bestIdx] = true;
    remaining -= 1n;
  }

  return parts;
}
