#![no_std]
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, Symbol,
};

mod events;
use events::*;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum PoolError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    ContractPaused = 3,
    InvalidAmount = 4,
    PoolSizeExceeded = 5,
    InsufficientBalance = 6,
    InsufficientLiquidity = 7,
    InvalidMaxPoolSize = 9,
    NoProposedAdmin = 10,
}

/// Storage keys.
///
/// v2 replaces the accumulator-style keys (Deposit, RewardDebt, ClaimableYield,
/// AccYieldPerDeposit, UnclaimedYieldPool) with a share-based (LP-token) model.
/// Yield is now implicit in the exchange rate between shares and underlying
/// assets — no separate accumulation or claim step is required.
///
/// All per-token keys carry the token address so one contract instance can
/// serve multiple token liquidity pools.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Paused,
    WithdrawalCooldown,
    /// token → max pool size cap (0 = unlimited)
    MaxPoolSize(Address),
    /// token → total LP shares outstanding across all providers
    TotalShares(Address),
    /// (provider, token) → LP shares held
    Shares(Address, Address),
    /// (provider, token) → ledger sequence of the most recent deposit
    DepositTimestamp(Address, Address),
    /// token → total principal deposited (net of withdrawals); used for
    /// utilisation stats and the MaxPoolSize cap
    TotalDeposits(Address),
    /// token → number of active depositors
    DepositorCount(Address),
    ProposedAdmin,
    Version,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PoolStats {
    pub total_deposits: i128,
    pub total_shares: i128,
    pub pool_token_balance: i128,
    pub depositor_count: u32,
    /// Fraction of tracked principal currently out on loan, in basis points.
    /// Only positive when active loans have reduced pool_balance below
    /// total_deposits.
    pub utilization_bps: u32,
}

#[contract]
pub struct LendingPool;

#[contractimpl]
impl LendingPool {
    const INSTANCE_TTL_THRESHOLD: u32 = 17280;
    const INSTANCE_TTL_BUMP: u32 = 518400;
    const PERSISTENT_TTL_THRESHOLD: u32 = 17280;
    const PERSISTENT_TTL_BUMP: u32 = 518400;
    const CURRENT_VERSION: u32 = 3;
    const DEFAULT_WITHDRAWAL_COOLDOWN: u32 = 1_440;

    // ── TTL helpers ───────────────────────────────────────────────────────

    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(Self::INSTANCE_TTL_THRESHOLD, Self::INSTANCE_TTL_BUMP);
    }

    fn bump_persistent_ttl(env: &Env, key: &DataKey) {
        env.storage().persistent().extend_ttl(
            key,
            Self::PERSISTENT_TTL_THRESHOLD,
            Self::PERSISTENT_TTL_BUMP,
        );
    }

    // ── Storage accessors ─────────────────────────────────────────────────

    fn admin(env: &Env) -> Address {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    fn pool_balance(env: &Env, token: &Address) -> i128 {
        TokenClient::new(env, token).balance(&env.current_contract_address())
    }

    fn total_deposits(env: &Env, token: &Address) -> i128 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::TotalDeposits(token.clone()))
            .unwrap_or(0)
    }

    fn total_shares(env: &Env, token: &Address) -> i128 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::TotalShares(token.clone()))
            .unwrap_or(0)
    }

    fn read_shares(env: &Env, provider: &Address, token: &Address) -> i128 {
        let key = DataKey::Shares(provider.clone(), token.clone());
        let shares: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if shares > 0 {
            Self::bump_persistent_ttl(env, &key);
        }
        shares
    }

    fn read_deposit_timestamp(env: &Env, provider: &Address, token: &Address) -> Option<u32> {
        let key = DataKey::DepositTimestamp(provider.clone(), token.clone());
        let deposit_ledger: Option<u32> = env.storage().persistent().get(&key);
        if deposit_ledger.is_some() {
            Self::bump_persistent_ttl(env, &key);
        }
        deposit_ledger
    }

    fn read_depositor_count(env: &Env, token: &Address) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::DepositorCount(token.clone()))
            .unwrap_or(0)
    }

    fn withdrawal_cooldown(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::WithdrawalCooldown)
            .unwrap_or(Self::DEFAULT_WITHDRAWAL_COOLDOWN)
    }

    fn assert_not_paused(env: &Env) -> Result<(), PoolError> {
        Self::bump_instance_ttl(env);
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            return Err(PoolError::ContractPaused);
        }
        Ok(())
    }

    // ── Share / asset math ────────────────────────────────────────────────

    /// LP shares to mint for `amount` of deposited assets.
    ///
    /// The first depositor always receives a 1-for-1 allocation.  Subsequent
    /// depositors receive `amount * total_shares / total_assets_before` so
    /// that the exchange rate is preserved and existing holders are not
    /// diluted.
    fn calc_shares_to_mint(
        amount: i128,
        total_assets_before: i128,
        cur_total_shares: i128,
    ) -> i128 {
        if cur_total_shares == 0 || total_assets_before == 0 {
            amount
        } else {
            amount
                .checked_mul(cur_total_shares)
                .and_then(|v| v.checked_div(total_assets_before))
                .expect("share mint overflow")
        }
    }

    /// Underlying assets redeemable for `shares` given current pool state.
    ///
    /// Returns `shares * total_assets / total_shares`, which automatically
    /// includes any yield that has accumulated since the shares were minted.
    fn calc_assets_to_redeem(shares: i128, total_assets: i128, cur_total_shares: i128) -> i128 {
        shares
            .checked_mul(total_assets)
            .and_then(|v| v.checked_div(cur_total_shares))
            .expect("share redeem overflow")
    }

    fn assert_withdrawal_cooldown_elapsed(env: &Env, provider: &Address, token: &Address) {
        let cooldown = Self::withdrawal_cooldown(env);
        if cooldown == 0 {
            return;
        }

        let Some(deposit_ledger) = Self::read_deposit_timestamp(env, provider, token) else {
            return;
        };

        let current_ledger = env.ledger().sequence();
        if current_ledger < deposit_ledger.saturating_add(cooldown) {
            panic!("withdrawal_cooldown_active");
        }
    }

    fn redeem_shares(
        env: &Env,
        provider: &Address,
        token: &Address,
        shares: i128,
    ) -> Result<(), PoolError> {
        if shares <= 0 {
            return Err(PoolError::InvalidAmount);
        }

        let cur_shares = Self::read_shares(env, provider, token);
        if cur_shares < shares {
            return Err(PoolError::InsufficientBalance);
        }

        let cur_total_shares = Self::total_shares(env, token);
        let total_assets = Self::pool_balance(env, token);
        let assets_to_return = Self::calc_assets_to_redeem(shares, total_assets, cur_total_shares);

        if assets_to_return <= 0 {
            return Err(PoolError::InvalidAmount);
        }

        TokenClient::new(env, token).transfer(
            &env.current_contract_address(),
            provider,
            &assets_to_return,
        );

        let share_key = DataKey::Shares(provider.clone(), token.clone());
        let deposit_key = DataKey::DepositTimestamp(provider.clone(), token.clone());
        let remaining = cur_shares.checked_sub(shares).expect("share underflow");
        if remaining == 0 {
            env.storage().persistent().remove(&share_key);
            env.storage().persistent().remove(&deposit_key);
            let count = Self::read_depositor_count(env, token);
            env.storage().instance().set(
                &DataKey::DepositorCount(token.clone()),
                &count.saturating_sub(1),
            );
        } else {
            env.storage().persistent().set(&share_key, &remaining);
            Self::bump_persistent_ttl(env, &share_key);
            Self::bump_persistent_ttl(env, &deposit_key);
        }

        let new_total_shares = cur_total_shares
            .checked_sub(shares)
            .expect("total shares underflow");
        env.storage()
            .instance()
            .set(&DataKey::TotalShares(token.clone()), &new_total_shares);

        let new_total_deposits = Self::total_deposits(env, token).saturating_sub(assets_to_return);
        env.storage()
            .instance()
            .set(&DataKey::TotalDeposits(token.clone()), &new_total_deposits);

        Self::bump_instance_ttl(env);
        withdraw(
            env,
            provider.clone(),
            token.clone(),
            assets_to_return,
            shares,
        );
        Ok(())
    }

    // ── Admin / lifecycle ─────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) -> Result<(), PoolError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(PoolError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(
            &DataKey::WithdrawalCooldown,
            &Self::DEFAULT_WITHDRAWAL_COOLDOWN,
        );
        env.storage()
            .instance()
            .set(&DataKey::Version, &Self::CURRENT_VERSION);
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    pub fn version(env: Env) -> u32 {
        Self::bump_instance_ttl(&env);
        env.storage().instance().get(&DataKey::Version).unwrap_or(0)
    }

    pub fn get_admin(env: Env) -> Address {
        Self::admin(&env)
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        Self::admin(&env).require_auth();
        let old_version = Self::version(env.clone());
        let new_version = old_version.saturating_add(1);
        env.storage()
            .instance()
            .set(&DataKey::Version, &new_version);
        env.events().publish(
            (Symbol::new(&env, "ContractUpgraded"),),
            (old_version, new_version),
        );
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    pub fn set_max_pool_size(env: Env, token: Address, max: i128) -> Result<(), PoolError> {
        Self::admin(&env).require_auth();
        if max < 0 {
            return Err(PoolError::InvalidMaxPoolSize);
        }

        let old_max = Self::get_max_pool_size(env.clone(), token.clone());

        env.storage()
            .instance()
            .set(&DataKey::MaxPoolSize(token.clone()), &max);
        Self::bump_instance_ttl(&env);

        deposit_cap_updated(&env, token, old_max, max);
        Ok(())
    }

    pub fn set_withdrawal_cooldown(env: Env, ledgers: u32) {
        Self::admin(&env).require_auth();

        let old_cooldown = Self::get_withdrawal_cooldown(env.clone());

        env.storage()
            .instance()
            .set(&DataKey::WithdrawalCooldown, &ledgers);
        Self::bump_instance_ttl(&env);

        withdrawal_cooldown_updated(&env, old_cooldown, ledgers);
    }

    pub fn get_max_pool_size(env: Env, token: Address) -> i128 {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::MaxPoolSize(token))
            .unwrap_or(0)
    }

    pub fn get_total_deposits(env: Env, token: Address) -> i128 {
        Self::total_deposits(&env, &token)
    }

    pub fn get_total_shares(env: Env, token: Address) -> i128 {
        Self::total_shares(&env, &token)
    }

    pub fn get_withdrawal_cooldown(env: Env) -> u32 {
        Self::withdrawal_cooldown(&env)
    }

    // ── Core pool operations ──────────────────────────────────────────────

    /// Deposit `amount` of `token` and receive LP shares in return.
    ///
    /// Shares are minted proportional to the current exchange rate so that
    /// existing depositors are not diluted.  Any yield already present in the
    /// pool is captured in the share price at the point of deposit, not
    /// credited to the new depositor.
    pub fn deposit(
        env: Env,
        provider: Address,
        token: Address,
        amount: i128,
    ) -> Result<(), PoolError> {
        provider.require_auth();
        Self::assert_not_paused(&env)?;

        if amount <= 0 {
            return Err(PoolError::InvalidAmount);
        }

        // MaxPoolSize cap uses tracked principal, not pool balance.
        let max: i128 = env
            .storage()
            .instance()
            .get(&DataKey::MaxPoolSize(token.clone()))
            .unwrap_or(0);
        if max > 0 {
            let total = Self::total_deposits(&env, &token);
            if total.checked_add(amount).expect("overflow") > max {
                return Err(PoolError::PoolSizeExceeded);
            }
        }

        // Snapshot pool state *before* the transfer so the share price
        // reflects the pre-deposit pool composition.
        let total_assets_before = Self::pool_balance(&env, &token);
        let cur_total_shares = Self::total_shares(&env, &token);

        let shares_to_mint =
            Self::calc_shares_to_mint(amount, total_assets_before, cur_total_shares);
        if shares_to_mint <= 0 {
            return Err(PoolError::InvalidAmount);
        }

        TokenClient::new(&env, &token).transfer(
            &provider,
            &env.current_contract_address(),
            &amount,
        );

        // Track new depositors.
        let existing_shares = Self::read_shares(&env, &provider, &token);
        if existing_shares == 0 {
            let count = Self::read_depositor_count(&env, &token);
            env.storage()
                .instance()
                .set(&DataKey::DepositorCount(token.clone()), &(count + 1));
        }

        let new_shares = existing_shares
            .checked_add(shares_to_mint)
            .expect("shares overflow");
        let share_key = DataKey::Shares(provider.clone(), token.clone());
        env.storage().persistent().set(&share_key, &new_shares);
        Self::bump_persistent_ttl(&env, &share_key);
        let deposit_key = DataKey::DepositTimestamp(provider.clone(), token.clone());
        let current_ledger = env.ledger().sequence();
        env.storage()
            .persistent()
            .set(&deposit_key, &current_ledger);
        Self::bump_persistent_ttl(&env, &deposit_key);

        let new_total_shares = cur_total_shares
            .checked_add(shares_to_mint)
            .expect("total shares overflow");
        env.storage()
            .instance()
            .set(&DataKey::TotalShares(token.clone()), &new_total_shares);

        let new_total_deposits = Self::total_deposits(&env, &token)
            .checked_add(amount)
            .expect("total deposits overflow");
        env.storage()
            .instance()
            .set(&DataKey::TotalDeposits(token.clone()), &new_total_deposits);

        Self::bump_instance_ttl(&env);
        deposit(
            &env,
            provider.clone(),
            token.clone(),
            amount,
            shares_to_mint,
        );
        Ok(())
    }

    /// Underlying asset value of `provider`'s LP shares (principal + yield).
    pub fn get_deposit(env: Env, provider: Address, token: Address) -> i128 {
        let shares = Self::read_shares(&env, &provider, &token);
        if shares == 0 {
            return 0;
        }
        let cur_total_shares = Self::total_shares(&env, &token);
        if cur_total_shares == 0 {
            return 0;
        }
        Self::calc_assets_to_redeem(shares, Self::pool_balance(&env, &token), cur_total_shares)
    }

    /// Raw LP share balance for `provider` in the `token` pool.
    pub fn get_shares(env: Env, provider: Address, token: Address) -> i128 {
        Self::read_shares(&env, &provider, &token)
    }

    /// Burn `shares` LP tokens and receive the proportional underlying assets.
    ///
    /// The redemption value is `shares * pool_balance / total_shares`, which
    /// automatically includes any interest that has been repaid to the pool
    /// since the shares were minted — no separate claim step is required.
    pub fn withdraw(
        env: Env,
        provider: Address,
        token: Address,
        shares: i128,
    ) -> Result<(), PoolError> {
        provider.require_auth();
        Self::assert_not_paused(&env)?;
        Self::assert_withdrawal_cooldown_elapsed(&env, &provider, &token);
        Self::redeem_shares(&env, &provider, &token, shares)
    }

    pub fn emergency_withdraw(
        env: Env,
        provider: Address,
        token: Address,
        shares: i128,
    ) -> Result<(), PoolError> {
        provider.require_auth();
        Self::redeem_shares(&env, &provider, &token, shares)
    }

    // ── Queries ───────────────────────────────────────────────────────────

    pub fn get_pool_stats(env: Env, token: Address) -> PoolStats {
        let total_deposits = Self::total_deposits(&env, &token);
        let total_shares = Self::total_shares(&env, &token);
        let pool_token_balance = Self::pool_balance(&env, &token);

        // Utilisation: portion of tracked principal currently out on loan.
        let utilization_bps = if total_deposits > 0 && pool_token_balance < total_deposits {
            let borrowed = total_deposits - pool_token_balance;
            ((borrowed * 10_000) / total_deposits) as u32
        } else {
            0
        };

        PoolStats {
            total_deposits,
            total_shares,
            pool_token_balance,
            depositor_count: Self::read_depositor_count(&env, &token),
            utilization_bps,
        }
    }

    // ── Admin governance ──────────────────────────────────────────────────

    pub fn propose_admin(env: Env, new_admin: Address) {
        let current_admin = Self::admin(&env);
        current_admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::ProposedAdmin, &new_admin);
        Self::bump_instance_ttl(&env);

        admin_proposed(&env, current_admin.clone(), new_admin.clone());
    }

    pub fn accept_admin(env: Env) -> Result<(), PoolError> {
        let proposed_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::ProposedAdmin)
            .ok_or(PoolError::NoProposedAdmin)?;
        proposed_admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::Admin, &proposed_admin);
        env.storage().instance().remove(&DataKey::ProposedAdmin);
        Self::bump_instance_ttl(&env);

        admin_transferred(&env, proposed_admin.clone());
        Ok(())
    }

    pub fn pause(env: Env) {
        Self::admin(&env).require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        Self::bump_instance_ttl(&env);

        pool_paused(&env);
    }

    pub fn unpause(env: Env) {
        Self::admin(&env).require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        Self::bump_instance_ttl(&env);

        pool_unpaused(&env);
    }

    pub fn is_paused(env: Env) -> bool {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }
}

#[cfg(test)]
mod test;
