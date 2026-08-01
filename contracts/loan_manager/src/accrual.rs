use soroban_sdk::{contracterror, contracttype, symbol_short, Env};

pub const INDEX_SCALE: i128 = 1_000_000_000_000_000_000; // 1e18

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum LoanError {
    IndexOverflow = 1,
    StaleIndex = 2,
    InsufficientRepayment = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    BorrowIndex,
}

pub fn mul_div(a: i128, b: i128, c: i128) -> Result<i128, LoanError> {
    if c == 0 {
        return Err(LoanError::IndexOverflow);
    }
    // Perform a widened multiplication
    // In actual soroban we would use I256 or similar, for now we will simulate half-up rounding.
    // Rust i128 can overflow so a 256-bit wide type is needed for production.
    let product = (a as i128).checked_mul(b as i128).ok_or(LoanError::IndexOverflow)?;
    
    // Half-up rounding
    let half_c = c / 2;
    let result = product.checked_add(half_c).ok_or(LoanError::IndexOverflow)?;
    
    Ok(result / c)
}

pub fn accrue(env: &Env, rate_per_ledger_scaled: i128) -> Result<i128, LoanError> {
    let mut index: i128 = env.storage().persistent().get(&DataKey::BorrowIndex).unwrap_or(INDEX_SCALE);
    
    index = mul_div(index, INDEX_SCALE + rate_per_ledger_scaled, INDEX_SCALE)?;
    
    env.storage().persistent().set(&DataKey::BorrowIndex, &index);
    env.storage().persistent().extend_ttl(&DataKey::BorrowIndex, 1000, 100000);
    
    env.events().publish((symbol_short!("accrue"),), (env.ledger().sequence(), index));
    
    Ok(index)
}

pub fn owed_amount(env: &Env, principal: i128, index_at_origination: i128) -> Result<i128, LoanError> {
    let current_index: i128 = env.storage().persistent().get(&DataKey::BorrowIndex).unwrap_or(INDEX_SCALE);
    // Add logic to check for StaleIndex
    // if current_ledger != last_accrued_ledger { return Err(LoanError::StaleIndex); }
    mul_div(principal, current_index, index_at_origination)
}
