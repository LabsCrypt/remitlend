// GENERATED FILE — do not edit by hand.
//
// Derived from `money-policy.json` at the repository root by
// `scripts/gen-money.ts`. Run `npx ts-node scripts/gen-money.ts` from the
// repo root to regenerate. CI's `money-policy` job fails the build if this
// file drifts from what the generator produces.

/// Number of fractional decimal places a stroop-denominated amount carries
/// on-chain (`10^scale` stroops per whole unit).
pub const SCALE: u32 = 7;

/// `10^SCALE`, i.e. the number of stroops in one whole unit.
pub const STROOP_SCALE: i128 = 10000000;

/// Default rounding mode applied when a division does not divide evenly.
/// Kept as a string (rather than `crate::RoundingMode`) so this generated
/// file never needs to import from hand-authored modules.
pub const DEFAULT_ROUNDING_MODE: &str = "half_even";

/// Number of decimal places used for user-facing display only. Settlement
/// math always uses the full `SCALE` precision.
pub const DISPLAY_DP: u32 = 2;

/// Strategy used to allocate a total among weighted shares without losing or
/// fabricating units.
pub const ALLOCATION_STRATEGY: &str = "largest_remainder";
