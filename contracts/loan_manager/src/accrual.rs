use crate::{DataKey, LoanError};
use soroban_sdk::{symbol_short, Env};

pub const INDEX_SCALE: i128 = 1_000_000_000_000_000_000; // 1e18

const PERSISTENT_TTL_THRESHOLD: u32 = 17280;
const PERSISTENT_TTL_BUMP: u32 = 518400;

/// Unsigned 256-bit integer for widened fixed-point arithmetic without intermediate overflow.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct U256 {
    pub hi: u128,
    pub lo: u128,
}

impl U256 {
    pub const ZERO: Self = Self { hi: 0, lo: 0 };

    pub fn from_u128(val: u128) -> Self {
        Self { hi: 0, lo: val }
    }

    pub fn add_u128(self, val: u128) -> Option<Self> {
        let (lo, carry) = self.lo.overflowing_add(val);
        let hi = self.hi.checked_add(if carry { 1 } else { 0 })?;
        Some(Self { hi, lo })
    }

    pub fn mul_u128(a: u128, b: u128) -> Self {
        let a_lo = a as u64 as u128;
        let a_hi = a >> 64;
        let b_lo = b as u64 as u128;
        let b_hi = b >> 64;

        let p0 = a_lo * b_lo;
        let p1 = a_lo * b_hi;
        let p2 = a_hi * b_lo;
        let p3 = a_hi * b_hi;

        let (mid, carry1) = p1.overflowing_add(p2);
        let carry_hi = if carry1 { 1u128 << 64 } else { 0 };

        let mid_lo = (mid as u64 as u128) << 64;
        let mid_hi = (mid >> 64) + carry_hi;

        let (lo, carry_lo) = p0.overflowing_add(mid_lo);
        let hi = p3 + mid_hi + if carry_lo { 1 } else { 0 };

        Self { hi, lo }
    }

    pub fn div_rem_u128(self, d: u128) -> Option<(Self, u128)> {
        if d == 0 {
            return None;
        }

        let mut q = Self::ZERO;
        let mut r = 0u128;

        for i in (0..256).rev() {
            let bit = if i >= 128 {
                (self.hi >> (i - 128)) & 1
            } else {
                (self.lo >> i) & 1
            };

            let carry = (r >> 127) != 0;
            r = (r << 1) | bit;

            if carry || r >= d {
                r = r.wrapping_sub(d);
                if i >= 128 {
                    q.hi |= 1 << (i - 128);
                } else {
                    q.lo |= 1 << i;
                }
            }
        }
        Some((q, r))
    }
}

/// Computes (a * b) / c with 256-bit widened intermediate product and half-up rounding.
/// Returns LoanError::IndexOverflow on divide-by-zero, invalid arguments, or i128 overflow.
pub fn mul_div(a: i128, b: i128, c: i128) -> Result<i128, LoanError> {
    if c <= 0 || a < 0 || b < 0 {
        return Err(LoanError::IndexOverflow);
    }

    let product = U256::mul_u128(a as u128, b as u128);
    let half_c = (c as u128) / 2;

    let rounded = product.add_u128(half_c).ok_or(LoanError::IndexOverflow)?;
    let (q, _) = rounded
        .div_rem_u128(c as u128)
        .ok_or(LoanError::IndexOverflow)?;

    if q.hi > 0 || q.lo > (i128::MAX as u128) {
        return Err(LoanError::IndexOverflow);
    }

    Ok(q.lo as i128)
}

/// Reads the current borrow index from persistent storage, or INDEX_SCALE if uninitialized.
pub fn get_borrow_index(env: &Env) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::BorrowIndex)
        .unwrap_or(INDEX_SCALE)
}

/// Reads the last ledger at which the borrow index was advanced.
pub fn get_last_accrued_ledger(env: &Env) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::LastAccruedLedger)
        .unwrap_or_else(|| env.ledger().sequence())
}

/// Advances the global cumulative BorrowIndex by rate_per_ledger_scaled for 1 ledger delta.
/// Emits an "accrue" event and updates persistent storage with TTL bump.
pub fn accrue(env: &Env, rate_per_ledger_scaled: i128) -> Result<i128, LoanError> {
    let current_ledger = env.ledger().sequence();
    let index = get_borrow_index(env);

    let rate_factor = INDEX_SCALE
        .checked_add(rate_per_ledger_scaled)
        .ok_or(LoanError::IndexOverflow)?;

    let next_index = mul_div(index, rate_factor, INDEX_SCALE)?;

    env.storage()
        .persistent()
        .set(&DataKey::BorrowIndex, &next_index);
    env.storage()
        .persistent()
        .set(&DataKey::LastAccruedLedger, &current_ledger);

    env.storage().persistent().extend_ttl(
        &DataKey::BorrowIndex,
        PERSISTENT_TTL_THRESHOLD,
        PERSISTENT_TTL_BUMP,
    );
    env.storage().persistent().extend_ttl(
        &DataKey::LastAccruedLedger,
        PERSISTENT_TTL_THRESHOLD,
        PERSISTENT_TTL_BUMP,
    );

    env.events()
        .publish((symbol_short!("accrue"),), (current_ledger, next_index));

    Ok(next_index)
}

/// Calculates owed amount: mul_div(principal, current_index, index_at_origination).
/// Fails with LoanError::StaleIndex if the index has not been advanced to current ledger sequence.
pub fn owed_amount(
    env: &Env,
    principal: i128,
    index_at_origination: i128,
) -> Result<i128, LoanError> {
    if principal <= 0 {
        return Ok(0);
    }
    if index_at_origination <= 0 {
        return Err(LoanError::IndexOverflow);
    }

    let current_ledger = env.ledger().sequence();
    let last_accrued: u32 = env
        .storage()
        .persistent()
        .get(&DataKey::LastAccruedLedger)
        .unwrap_or(0);

    if last_accrued < current_ledger {
        return Err(LoanError::StaleIndex);
    }

    let current_index = get_borrow_index(env);
    mul_div(principal, current_index, index_at_origination)
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn test_u256_mul_and_div() {
        let a = 1_000_000_000_000_000_000u128; // 1e18
        let b = 2_000_000_000_000_000_000u128; // 2e18
        let prod = U256::mul_u128(a, b);
        assert_eq!(prod.hi, 108); // 2e36 >> 128
        let (q, r) = prod.div_rem_u128(a).unwrap();
        assert_eq!(q.hi, 0);
        assert_eq!(q.lo, b);
        assert_eq!(r, 0);
    }

    #[test]
    fn test_mul_div_half_up_rounding() {
        // Exact tie: 1 * 1 / 2 => 0.5 -> 1 with half-up
        assert_eq!(mul_div(1, 1, 2).unwrap(), 1);

        // Less than half: 1 * 1 / 3 => 0.333... -> 0
        assert_eq!(mul_div(1, 1, 3).unwrap(), 0);

        // Greater than half: 2 * 1 / 3 => 0.666... -> 1
        assert_eq!(mul_div(2, 1, 3).unwrap(), 1);

        // Scaled identity: 100 * 1e18 / 1e18 = 100
        assert_eq!(mul_div(100, INDEX_SCALE, INDEX_SCALE).unwrap(), 100);
    }

    #[test]
    fn test_mul_div_overflow() {
        // Zero denominator
        assert_eq!(mul_div(10, 10, 0), Err(LoanError::IndexOverflow));

        // Negative numbers
        assert_eq!(mul_div(-1, 10, 10), Err(LoanError::IndexOverflow));
        assert_eq!(mul_div(10, -1, 10), Err(LoanError::IndexOverflow));
        assert_eq!(mul_div(10, 10, -1), Err(LoanError::IndexOverflow));

        // Overflow result > i128::MAX
        assert_eq!(mul_div(i128::MAX, 2, 1), Err(LoanError::IndexOverflow));
    }

    #[test]
    fn test_accrue_and_stale_index() {
        let env = Env::default();
        let rate_per_ledger = 7_922_020_087i128; // ~5% APR / 6,311,520 ledgers scaled to 1e18

        let origination_index = get_borrow_index(&env);
        assert_eq!(origination_index, INDEX_SCALE);

        // Advancing ledger sequence without calling accrue triggers StaleIndex
        let principal = 10_0000000; // 10 XLM in stroops
        assert_eq!(
            owed_amount(&env, principal, origination_index),
            Err(LoanError::StaleIndex)
        );

        // Calling accrue brings the index up to the current ledger
        let new_index = accrue(&env, rate_per_ledger).unwrap();
        assert!(new_index > origination_index);

        // Now owed_amount succeeds
        let owed = owed_amount(&env, principal, origination_index).unwrap();
        assert!(owed >= principal);
    }

    #[test]
    fn test_sub_stroop_principal_accrual() {
        let env = Env::default();
        let rate_per_ledger = 7_922_020_087i128;

        let origin_index = get_borrow_index(&env);
        let principal = 1_0000000; // 1 XLM = 10^7 stroops

        // Advance 100 ledgers
        for _ in 0..100 {
            accrue(&env, rate_per_ledger).unwrap();
        }

        let owed = owed_amount(&env, principal, origin_index).unwrap();
        // Over 100 ledgers at 5% APR, 1 XLM accrues:
        // 1e7 * (100 * 7.922e9 / 1e18) = 7.922 stroops => 8 stroops rounded.
        assert_eq!(owed, principal + 8);
    }
}
