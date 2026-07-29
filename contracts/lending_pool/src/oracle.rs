// Oracle price-freshness gate (issue #1379, Phase 1 — contract-side only).
//
// `lending_pool` does not currently call out to a live on-chain rate oracle
// (rate logic lives in `loan_manager`, which only receives a raw `u32` rate
// with no staleness metadata at all). This module adds the reusable
// staleness-check primitive called out in the issue's file list
// (`contracts/lending_pool/src/oracle.rs`): an admin-pushed price cache with
// an `updated_ledger` watermark, and a `require_fresh_price` gate that
// reverts once a cached price is older than a configurable max age.
//
// This is intentionally narrow: it does not implement the pause/resume
// circuit-breaker state machine, event emission for staleness, or wiring
// into `loan_manager`'s borrow/liquidate paths — see the PR description for
// what is deferred to follow-up phases.

use crate::{DataKey, PoolError};
use soroban_sdk::{contracttype, Address, Env};

/// Default maximum age (in ledgers) a cached oracle price may have before
/// `require_fresh_price` rejects it. ~5 minutes at a 5s ledger close time.
pub const DEFAULT_ORACLE_MAX_AGE_LEDGERS: u32 = 60;

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PriceData {
    pub rate: i128,
    pub updated_ledger: u32,
}

/// Admin-only: push a new price for `asset`, stamped with the current ledger
/// sequence. Stands in for a live oracle feed until this contract is wired
/// to one in a later phase.
pub fn set_oracle_price(env: &Env, admin: &Address, asset: &Address, rate: i128) {
    admin.require_auth();
    let price = PriceData {
        rate,
        updated_ledger: env.ledger().sequence(),
    };
    env.storage()
        .instance()
        .set(&DataKey::OraclePrice(asset.clone()), &price);
}

/// Admin-only: configure the maximum age (in ledgers) a cached price may
/// have before it is considered stale.
pub fn set_oracle_max_age(env: &Env, admin: &Address, max_age: u32) {
    admin.require_auth();
    env.storage()
        .instance()
        .set(&DataKey::OracleMaxAge, &max_age);
}

/// Read the configured max age, falling back to `DEFAULT_ORACLE_MAX_AGE_LEDGERS`.
pub fn oracle_max_age(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::OracleMaxAge)
        .unwrap_or(DEFAULT_ORACLE_MAX_AGE_LEDGERS)
}

/// Read the cached price for `asset` and revert with `PoolError::OracleStale`
/// if it is older than the configured max age, or `PoolError::NotInitialized`
/// if no price has ever been recorded for this asset.
pub fn require_fresh_price(env: &Env, asset: &Address) -> Result<PriceData, PoolError> {
    let price: PriceData = env
        .storage()
        .instance()
        .get(&DataKey::OraclePrice(asset.clone()))
        .ok_or(PoolError::NotInitialized)?;

    let current_ledger = env.ledger().sequence();
    let age = current_ledger.saturating_sub(price.updated_ledger);
    let max_age = oracle_max_age(env);

    if age > max_age {
        return Err(PoolError::OracleStale);
    }

    Ok(price)
}
