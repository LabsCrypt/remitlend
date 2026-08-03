//! Cross-layer money policy shared by every RemitLend contract.
//!
//! This crate is the single place where stroop-denominated `i128` amounts are
//! divided, rounded, or split pro-rata. Every contract that touches a stroop
//! quantity must route the conversion through [`round_div`] or
//! [`split_pro_rata`] rather than using a bare `/` — that is what keeps this
//! crate's semantics, the backend's `decimal.ts`, and the frontend's
//! generated formatter in lock-step (see `money-policy.json` at the repo
//! root and `scripts/gen-money.ts`).
#![no_std]

pub mod policy;

use soroban_sdk::{contracterror, Env, Vec};

/// Number of stroops in one whole unit (`10^7`), re-exported from
/// [`policy::STROOP_SCALE`] for ergonomic access at the crate root.
pub const STROOP_SCALE: i128 = policy::STROOP_SCALE;

/// Rounding strategy applied by [`round_div`] when a division has a nonzero
/// remainder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoundingMode {
    /// Round to the nearest value; ties round to the nearest even quotient
    /// (banker's rounding). This is the default settlement mode used by the
    /// backend and contracts alike, chosen because it does not bias
    /// accumulated rounding error in either direction over many operations.
    HalfEven,
    /// Round to the nearest value; ties round away from zero.
    HalfUp,
    /// Always round toward negative infinity.
    Floor,
    /// Always round toward positive infinity.
    Ceil,
}

/// Errors produced by the money-policy helpers.
#[contracterror]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum MathError {
    /// An intermediate or final value overflowed `i128`.
    Overflow = 1,
    /// The denominator supplied to a division was zero.
    DivByZero = 2,
    /// A post-condition invariant (e.g. pro-rata parts summing to the
    /// total) failed to hold, indicating a drift between layers.
    DriftDetected = 3,
}

/// Divide `num` by `den`, applying `mode` to any remainder.
///
/// This is the *only* sanctioned way to divide a stroop quantity in this
/// codebase. All intermediate arithmetic is overflow-checked.
pub fn round_div(num: i128, den: i128, mode: RoundingMode) -> Result<i128, MathError> {
    if den == 0 {
        return Err(MathError::DivByZero);
    }

    // Normalize so `den` is always positive; fold its sign into `num`.
    let (num, den) = if den < 0 {
        (
            num.checked_neg().ok_or(MathError::Overflow)?,
            den.checked_neg().ok_or(MathError::Overflow)?,
        )
    } else {
        (num, den)
    };

    let quotient = num / den;
    let remainder = num % den;

    if remainder == 0 {
        return Ok(quotient);
    }

    // `remainder` has the same sign as `num` (Rust's truncating division
    // semantics). `abs_remainder` lets each rounding mode reason about
    // magnitude only; the sign is reapplied below.
    let remainder_is_negative = remainder < 0;
    let abs_remainder = remainder.checked_abs().ok_or(MathError::Overflow)?;

    let round_away_from_zero = match mode {
        RoundingMode::Floor => remainder_is_negative,
        RoundingMode::Ceil => !remainder_is_negative,
        RoundingMode::HalfUp => abs_remainder.checked_mul(2).ok_or(MathError::Overflow)? >= den,
        RoundingMode::HalfEven => {
            let doubled = abs_remainder.checked_mul(2).ok_or(MathError::Overflow)?;
            match doubled.cmp(&den) {
                core::cmp::Ordering::Greater => true,
                core::cmp::Ordering::Less => false,
                // Exact tie: round to even.
                core::cmp::Ordering::Equal => quotient % 2 != 0,
            }
        }
    };

    if round_away_from_zero {
        if remainder_is_negative {
            quotient.checked_sub(1).ok_or(MathError::Overflow)
        } else {
            quotient.checked_add(1).ok_or(MathError::Overflow)
        }
    } else {
        Ok(quotient)
    }
}

/// Split `total` among `weights` using the largest-remainder method so the
/// returned parts sum *exactly* to `total` (no dust is created or lost),
/// while staying as proportional to each weight as integer stroops allow.
///
/// Each part is first assigned `floor(total * weight / sum(weights))`. The
/// leftover units (`total - sum(floors)`) are then distributed one-by-one to
/// the entries with the largest fractional remainder, breaking ties by
/// index (lowest index first) for determinism.
///
/// `total` and every weight must be non-negative, and at least one weight
/// must be nonzero (unless `total` is zero, in which case every part is
/// zero).
pub fn split_pro_rata(env: &Env, total: i128, weights: &Vec<i128>) -> Result<Vec<i128>, MathError> {
    let n = weights.len();
    let mut parts = Vec::new(env);
    if n == 0 {
        return if total == 0 {
            Ok(parts)
        } else {
            Err(MathError::DriftDetected)
        };
    }

    let mut weight_sum: i128 = 0;
    for w in weights.iter() {
        if w < 0 {
            return Err(MathError::DriftDetected);
        }
        weight_sum = weight_sum.checked_add(w).ok_or(MathError::Overflow)?;
    }

    if weight_sum == 0 {
        for _ in 0..n {
            parts.push_back(0);
        }
        return if total == 0 {
            Ok(parts)
        } else {
            Err(MathError::DriftDetected)
        };
    }

    // First pass: floor allocation + remainder (scaled by weight_sum so we
    // can compare remainders across entries without floating point).
    let mut remainders: Vec<(u32, i128)> = Vec::new(env);
    let mut allocated: i128 = 0;
    for (idx, w) in weights.iter().enumerate() {
        let numerator = total.checked_mul(w).ok_or(MathError::Overflow)?;
        let floor_part = numerator / weight_sum;
        let remainder = numerator % weight_sum;
        parts.push_back(floor_part);
        allocated = allocated
            .checked_add(floor_part)
            .ok_or(MathError::Overflow)?;
        remainders.push_back((idx as u32, remainder));
    }

    let mut leftover = total.checked_sub(allocated).ok_or(MathError::Overflow)?;
    if leftover < 0 {
        return Err(MathError::DriftDetected);
    }

    // Selection sort descending by remainder (n is expected to be small —
    // pool participants / loan tranches — so O(n^2) is fine and avoids
    // pulling in an allocator-backed sort).
    let remainder_count = remainders.len();
    let mut sorted: Vec<(u32, i128)> = Vec::new(env);
    let mut used = Vec::new(env);
    for _ in 0..remainder_count {
        used.push_back(false);
    }
    for _ in 0..remainder_count {
        let mut best_idx: Option<u32> = None;
        let mut best_remainder: i128 = -1;
        for i in 0..remainder_count {
            if used.get(i).unwrap() {
                continue;
            }
            let (orig_idx, rem) = remainders.get(i).unwrap();
            match rem.cmp(&best_remainder) {
                core::cmp::Ordering::Greater => {
                    best_remainder = rem;
                    best_idx = Some(i);
                }
                core::cmp::Ordering::Equal => {
                    if let Some(cur_best) = best_idx {
                        let (cur_orig, _) = remainders.get(cur_best).unwrap();
                        if orig_idx < cur_orig {
                            best_idx = Some(i);
                        }
                    }
                }
                core::cmp::Ordering::Less => {}
            }
        }
        let chosen = best_idx.expect("remainder_count entries remain");
        used.set(chosen, true);
        sorted.push_back(remainders.get(chosen).unwrap());
    }

    let mut i = 0u32;
    while leftover > 0 {
        let (orig_idx, _) = sorted.get(i).unwrap();
        let current = parts.get(orig_idx).unwrap();
        parts.set(orig_idx, current.checked_add(1).ok_or(MathError::Overflow)?);
        leftover -= 1;
        i += 1;
        if i >= remainder_count {
            i = 0;
        }
    }

    Ok(parts)
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::Env;

    fn v(env: &Env, xs: &[i128]) -> Vec<i128> {
        Vec::from_slice(env, xs)
    }

    #[test]
    fn round_div_floor() {
        assert_eq!(round_div(7, 2, RoundingMode::Floor), Ok(3));
        assert_eq!(round_div(-7, 2, RoundingMode::Floor), Ok(-4));
        assert_eq!(round_div(6, 2, RoundingMode::Floor), Ok(3));
    }

    #[test]
    fn round_div_ceil() {
        assert_eq!(round_div(7, 2, RoundingMode::Ceil), Ok(4));
        assert_eq!(round_div(-7, 2, RoundingMode::Ceil), Ok(-3));
        assert_eq!(round_div(6, 2, RoundingMode::Ceil), Ok(3));
    }

    #[test]
    fn round_div_half_up() {
        assert_eq!(round_div(5, 2, RoundingMode::HalfUp), Ok(3)); // 2.5 -> 3
        assert_eq!(round_div(-5, 2, RoundingMode::HalfUp), Ok(-3));
        assert_eq!(round_div(7, 2, RoundingMode::HalfUp), Ok(4)); // 3.5 -> 4
        assert_eq!(round_div(1, 4, RoundingMode::HalfUp), Ok(0)); // 0.25 -> 0
    }

    #[test]
    fn round_div_half_even() {
        assert_eq!(round_div(5, 2, RoundingMode::HalfEven), Ok(2)); // 2.5 -> 2 (even)
        assert_eq!(round_div(7, 2, RoundingMode::HalfEven), Ok(4)); // 3.5 -> 4 (even)
        assert_eq!(round_div(9, 2, RoundingMode::HalfEven), Ok(4)); // 4.5 -> 4 (even)
        assert_eq!(round_div(3, 2, RoundingMode::HalfEven), Ok(2)); // 1.5 -> 2 (even)
        assert_eq!(round_div(-5, 2, RoundingMode::HalfEven), Ok(-2));
    }

    #[test]
    fn round_div_div_by_zero() {
        assert_eq!(
            round_div(5, 0, RoundingMode::HalfEven),
            Err(MathError::DivByZero)
        );
    }

    #[test]
    fn split_pro_rata_sums_to_total() {
        let env = Env::default();
        let cases: &[(i128, &[i128])] = &[
            (100, &[1, 1, 1]),
            (101, &[1, 1, 1]),
            (1_000_000_007, &[3, 5, 7, 11]),
            (7, &[1, 1, 1, 1, 1, 1, 1]),
            (0, &[1, 2, 3]),
            (1, &[1]),
            (10_000_000, &[333, 333, 334]),
        ];
        for (total, weights) in cases {
            let w = v(&env, weights);
            let parts = split_pro_rata(&env, *total, &w).unwrap();
            let sum: i128 = parts.iter().sum();
            assert_eq!(sum, *total, "parts must sum exactly to total");
            assert_eq!(parts.len(), w.len());
        }
    }

    #[test]
    fn split_pro_rata_randomized_sum_invariance() {
        use rand::rngs::StdRng;
        use rand::{Rng, SeedableRng};

        let mut rng = StdRng::seed_from_u64(0x1378_1378_1378_1378);

        for _ in 0..1_000 {
            // Fresh env per iteration: the test host meters a budget per
            // `Env`, and reusing one across thousands of Vec operations
            // would exceed it even though each individual allocation is tiny.
            let env = Env::default();
            let n = rng.gen_range(1..=12);
            let total: i128 = rng.gen_range(0..=1_000_000_000_000i128);
            let weights: Vec<i128> = {
                let mut w = Vec::new(&env);
                for _ in 0..n {
                    w.push_back(rng.gen_range(0..=1_000_000i128));
                }
                w
            };
            // Ensure at least one nonzero weight so the case is well-formed.
            let weight_sum: i128 = weights.iter().sum();
            if weight_sum == 0 {
                continue;
            }
            let parts = split_pro_rata(&env, total, &weights).unwrap();
            let sum: i128 = parts.iter().sum();
            assert_eq!(sum, total);
            for p in parts.iter() {
                assert!(p >= 0, "no negative allocation");
            }
        }
    }

    #[test]
    fn split_pro_rata_zero_weights_error_on_nonzero_total() {
        let env = Env::default();
        let w = v(&env, &[0, 0, 0]);
        assert_eq!(split_pro_rata(&env, 100, &w), Err(MathError::DriftDetected));
        assert_eq!(split_pro_rata(&env, 0, &w), Ok(v(&env, &[0, 0, 0])));
    }
}
