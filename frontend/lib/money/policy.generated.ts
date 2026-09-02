// GENERATED FILE — do not edit by hand.
//
// Derived from `money-policy.json` at the repository root by
// `scripts/gen-money.ts`. Run `npx ts-node scripts/gen-money.ts` from the
// repo root to regenerate. CI's `money-policy` job fails the build if this
// file drifts from what the generator produces.
//
// Deliberately dependency-free (no imports from hand-authored modules like
// decimal.ts/format.ts) so this file can never form an import cycle with the
// logic that consumes it. `MODE` is a plain string union rather than the
// `RoundingMode` enum for the same reason — consumers map it to their own
// enum.
//
// Uses `BigInt(...)` rather than a `123n` literal so this file type-checks
// under the frontend's ES2017 `tsconfig.json` target too (BigInt literal
// syntax requires ES2020+; the runtime value is identical either way).

/** Number of fractional decimal places a stroop amount carries on-chain. */
export const SCALE_DECIMALS = 7;

/** `BigInt(10) ** BigInt(SCALE_DECIMALS)`, i.e. stroops per whole unit. */
export const SCALE: bigint = BigInt(10000000);

/** Default rounding mode every layer must agree on for settlement math. */
export const MODE = "half_even" as const;

/**
 * Fractional digits used for *display only* — settlement always uses
 * `SCALE_DECIMALS` (full stroop precision).
 */
export const DISPLAY_DP = 2;

/** Strategy used to allocate a total among weighted shares. */
export const ALLOCATION_STRATEGY = "largest_remainder" as const;
