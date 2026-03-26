#![no_std]
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short, Address, BytesN, Env,
    Symbol,
};

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
    NoYieldAvailable = 8,
    InvalidMaxPoolSize = 9,
    NoProposedAdmin = 10,
}

/// Storage keys.
///
/// Deposit, RewardDebt and ClaimableYield are now keyed by (provider, token)
/// so that one pool contract can manage multiple token liquidity pools.
/// All aggregate counters (TotalDeposits, AccYieldPerDeposit, etc.) are
/// similarly keyed by token.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// (provider, token) → deposited balance
    Deposit(Address, Address),
    Admin,
    Paused,
    /// (provider, token) → reward-debt index snapshot
    RewardDebt(Address, Address),
    /// (provider, token) → claimable yield accumulated
    ClaimableYield(Address, Address),
    /// token → max pool size cap (0 = unlimited)
    MaxPoolSize(Address),
    /// token → total deposits across all providers
    TotalDeposits(Address),
    /// token → number of active depositors
    DepositorCount(Address),
    /// token → accumulated yield-per-deposit index (scaled)
    AccYieldPerDeposit(Address),
    /// token → total unclaimed yield in pool
    UnclaimedYieldPool(Address),
    ProposedAdmin,
    Version,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PoolStats {
    pub total_deposits: i128,
    pub pool_token_balance: i128,
    pub depositor_count: u32,
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
    const CURRENT_VERSION: u32 = 2;
    const YIELD_SCALE: i128 = 1_000_000_000;

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

    fn admin(env: &Env) -> Address {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    fn pool_balance(env: &Env, token: &Address) -> i128 {
        let token_client = TokenClient::new(env, token);
        token_client.balance(&env.current_contract_address())
    }

    fn total_deposits(env: &Env, token: &Address) -> i128 {
        Self::bump_instance_ttl(env);
        let key = DataKey::TotalDeposits(token.clone());
        env.storage().instance().get(&key).unwrap_or(0)
    }

    fn acc_yield_per_deposit(env: &Env, token: &Address) -> i128 {
        Self::bump_instance_ttl(env);
        let key = DataKey::AccYieldPerDeposit(token.clone());
        env.storage().instance().get(&key).unwrap_or(0)
    }

    fn unclaimed_yield_pool(env: &Env, token: &Address) -> i128 {
        Self::bump_instance_ttl(env);
        let key = DataKey::UnclaimedYieldPool(token.clone());
        env.storage().instance().get(&key).unwrap_or(0)
    }

    fn read_deposit(env: &Env, provider: &Address, token: &Address) -> i128 {
        let key = DataKey::Deposit(provider.clone(), token.clone());
        let balance = env.storage().persistent().get(&key).unwrap_or(0);
        if balance > 0 {
            Self::bump_persistent_ttl(env, &key);
        }
        balance
    }

    fn read_reward_debt(env: &Env, provider: &Address, token: &Address) -> i128 {
        let key = DataKey::RewardDebt(provider.clone(), token.clone());
        let debt = env.storage().persistent().get(&key).unwrap_or(0);
        if debt != 0 {
            Self::bump_persistent_ttl(env, &key);
        }
        debt
    }

    fn read_claimable_yield(env: &Env, provider: &Address, token: &Address) -> i128 {
        let key = DataKey::ClaimableYield(provider.clone(), token.clone());
        let claimable = env.storage().persistent().get(&key).unwrap_or(0);
        if claimable > 0 {
            Self::bump_persistent_ttl(env, &key);
        }
        claimable
    }

    fn write_reward_debt(env: &Env, provider: &Address, token: &Address, amount: i128) {
        let key = DataKey::RewardDebt(provider.clone(), token.clone());
        if amount == 0 {
            env.storage().persistent().remove(&key);
            return;
        }
        env.storage().persistent().set(&key, &amount);
        Self::bump_persistent_ttl(env, &key);
    }

    fn write_claimable_yield(env: &Env, provider: &Address, token: &Address, amount: i128) {
        let key = DataKey::ClaimableYield(provider.clone(), token.clone());
        if amount == 0 {
            env.storage().persistent().remove(&key);
            return;
        }
        env.storage().persistent().set(&key, &amount);
        Self::bump_persistent_ttl(env, &key);
    }

    fn sync_yield(env: &Env, token: &Address) {
        let total_deposits = Self::total_deposits(env, token);
        if total_deposits <= 0 {
            return;
        }

        let pool_balance = Self::pool_balance(env, token);
        let current_excess = if pool_balance > total_deposits {
            pool_balance - total_deposits
        } else {
            0
        };
        let accounted_yield = Self::unclaimed_yield_pool(env, token);

        if current_excess <= accounted_yield {
            return;
        }

        let new_yield = current_excess
            .checked_sub(accounted_yield)
            .expect("yield underflow");
        let increment = new_yield
            .checked_mul(Self::YIELD_SCALE)
            .and_then(|value| value.checked_div(total_deposits))
            .expect("yield index overflow");

        if increment == 0 {
            return;
        }

        let next_index = Self::acc_yield_per_deposit(env, token)
            .checked_add(increment)
            .expect("yield index overflow");
        let next_unclaimed = accounted_yield
            .checked_add(new_yield)
            .expect("yield pool overflow");

        let acc_key = DataKey::AccYieldPerDeposit(token.clone());
        let unclaimed_key = DataKey::UnclaimedYieldPool(token.clone());
        env.storage().instance().set(&acc_key, &next_index);
        env.storage().instance().set(&unclaimed_key, &next_unclaimed);
        Self::bump_instance_ttl(env);
    }

    fn harvest_provider(env: &Env, provider: &Address, token: &Address) {
        let deposit = Self::read_deposit(env, provider, token);
        if deposit <= 0 {
            return;
        }

        let accrued = deposit
            .checked_mul(Self::acc_yield_per_deposit(env, token))
            .and_then(|value| value.checked_div(Self::YIELD_SCALE))
            .expect("yield accrual overflow");
        let reward_debt = Self::read_reward_debt(env, provider, token);
        let pending = accrued
            .checked_sub(reward_debt)
            .expect("reward debt exceeds accrued yield");

        if pending > 0 {
            let claimable = Self::read_claimable_yield(env, provider, token)
                .checked_add(pending)
                .expect("claimable yield overflow");
            Self::write_claimable_yield(env, provider, token, claimable);
        }

        Self::write_reward_debt(env, provider, token, accrued);
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

    fn read_depositor_count(env: &Env, token: &Address) -> u32 {
        let key = DataKey::DepositorCount(token.clone());
        env.storage().instance().get(&key).unwrap_or(0)
    }

    pub fn initialize(env: Env, admin: Address) -> Result<(), PoolError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(PoolError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
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
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    pub fn set_max_pool_size(env: Env, token: Address, max: i128) -> Result<(), PoolError> {
        let admin = Self::admin(&env);
        admin.require_auth();

        if max < 0 {
            return Err(PoolError::InvalidMaxPoolSize);
        }
        let key = DataKey::MaxPoolSize(token.clone());
        env.storage().instance().set(&key, &max);
        Self::bump_instance_ttl(&env);
        env.events().publish((symbol_short!("MaxPool"), token), max);

        Ok(())
    }

    pub fn get_max_pool_size(env: Env, token: Address) -> i128 {
        Self::bump_instance_ttl(&env);
        let key = DataKey::MaxPoolSize(token);
        env.storage().instance().get(&key).unwrap_or(0)
    }

    pub fn get_total_deposits(env: Env, token: Address) -> i128 {
        Self::total_deposits(&env, &token)
    }

    pub fn deposit(env: Env, provider: Address, token: Address, amount: i128) -> Result<(), PoolError> {
        provider.require_auth();
        Self::assert_not_paused(&env)?;

        if amount <= 0 {
            return Err(PoolError::InvalidAmount);
        }

        let max_key = DataKey::MaxPoolSize(token.clone());
        let max: i128 = env.storage().instance().get(&max_key).unwrap_or(0);
        if max > 0 {
            let total = Self::total_deposits(&env, &token);
            if total.checked_add(amount).expect("overflow") > max {
                return Err(PoolError::PoolSizeExceeded);
            }
        }

        Self::sync_yield(&env, &token);
        Self::harvest_provider(&env, &provider, &token);

        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&provider, &env.current_contract_address(), &amount);

        let deposit_key = DataKey::Deposit(provider.clone(), token.clone());
        let current_balance = Self::read_deposit(&env, &provider, &token);

        if current_balance == 0 {
            let count = Self::read_depositor_count(&env, &token);
            let count_key = DataKey::DepositorCount(token.clone());
            env.storage().instance().set(&count_key, &(count + 1));
        }

        let next_balance = current_balance
            .checked_add(amount)
            .expect("deposit overflow");
        env.storage().persistent().set(&deposit_key, &next_balance);
        Self::bump_persistent_ttl(&env, &deposit_key);

        let total_deposits_key = DataKey::TotalDeposits(token.clone());
        let total_deposits = Self::total_deposits(&env, &token)
            .checked_add(amount)
            .expect("total deposits overflow");
        env.storage()
            .instance()
            .set(&total_deposits_key, &total_deposits);
        Self::bump_instance_ttl(&env);

        let reward_debt = next_balance
            .checked_mul(Self::acc_yield_per_deposit(&env, &token))
            .and_then(|value| value.checked_div(Self::YIELD_SCALE))
            .expect("reward debt overflow");
        Self::write_reward_debt(&env, &provider, &token, reward_debt);
        env.events()
            .publish((symbol_short!("Deposit"), provider, token), amount);

        Ok(())
    }

    pub fn get_deposit(env: Env, provider: Address, token: Address) -> i128 {
        Self::read_deposit(&env, &provider, &token)
    }

    pub fn withdraw(env: Env, provider: Address, token: Address, amount: i128) -> Result<(), PoolError> {
        provider.require_auth();
        Self::assert_not_paused(&env)?;

        if amount <= 0 {
            return Err(PoolError::InvalidAmount);
        }

        Self::sync_yield(&env, &token);
        Self::harvest_provider(&env, &provider, &token);

        let deposit_key = DataKey::Deposit(provider.clone(), token.clone());
        let current_balance = Self::read_deposit(&env, &provider, &token);
        if current_balance < amount {
            return Err(PoolError::InsufficientBalance);
        }
        let token_client = TokenClient::new(&env, &token);
        let pool_address = env.current_contract_address();
        let pool_balance = token_client.balance(&pool_address);
        if pool_balance < amount {
            return Err(PoolError::InsufficientLiquidity);
        }
        let remaining_pool_balance = pool_balance
            .checked_sub(amount)
            .expect("withdraw underflow");
        if remaining_pool_balance < Self::unclaimed_yield_pool(&env, &token) {
            return Err(PoolError::InsufficientLiquidity);
        }
        token_client.transfer(&pool_address, &provider, &amount);

        let new_balance = current_balance
            .checked_sub(amount)
            .expect("withdraw underflow");
        if new_balance == 0 {
            env.storage().persistent().remove(&deposit_key);
            env.storage()
                .persistent()
                .remove(&DataKey::RewardDebt(provider.clone(), token.clone()));

            let count = Self::read_depositor_count(&env, &token);
            let count_key = DataKey::DepositorCount(token.clone());
            env.storage()
                .instance()
                .set(&count_key, &count.saturating_sub(1));
        } else {
            env.storage().persistent().set(&deposit_key, &new_balance);
            Self::bump_persistent_ttl(&env, &deposit_key);
            let reward_debt = new_balance
                .checked_mul(Self::acc_yield_per_deposit(&env, &token))
                .and_then(|value| value.checked_div(Self::YIELD_SCALE))
                .expect("reward debt overflow");
            Self::write_reward_debt(&env, &provider, &token, reward_debt);
        }

        let total_deposits_key = DataKey::TotalDeposits(token.clone());
        let total_deposits = Self::total_deposits(&env, &token)
            .checked_sub(amount)
            .expect("total deposits underflow");
        env.storage()
            .instance()
            .set(&total_deposits_key, &total_deposits);
        Self::bump_instance_ttl(&env);

        env.events()
            .publish((symbol_short!("Withdraw"), provider, token), amount);

        Ok(())
    }

    pub fn claim_yield(env: Env, provider: Address, token: Address) -> Result<(), PoolError> {
        provider.require_auth();
        Self::assert_not_paused(&env)?;

        Self::sync_yield(&env, &token);
        Self::harvest_provider(&env, &provider, &token);

        let claimable = Self::read_claimable_yield(&env, &provider, &token);
        if claimable <= 0 {
            return Err(PoolError::NoYieldAvailable);
        }

        let pool_balance = Self::pool_balance(&env, &token);
        let total_deposits = Self::total_deposits(&env, &token);
        let available_yield = if pool_balance > total_deposits {
            pool_balance - total_deposits
        } else {
            0
        };
        if available_yield < claimable {
            return Err(PoolError::InsufficientLiquidity);
        }

        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &provider, &claimable);

        Self::write_claimable_yield(&env, &provider, &token, 0);
        let unclaimed_key = DataKey::UnclaimedYieldPool(token.clone());
        let remaining_unclaimed = Self::unclaimed_yield_pool(&env, &token)
            .checked_sub(claimable)
            .expect("unclaimed yield underflow");
        env.storage()
            .instance()
            .set(&unclaimed_key, &remaining_unclaimed);
        Self::bump_instance_ttl(&env);

        env.events()
            .publish((Symbol::new(&env, "YieldClaimed"), provider, token), claimable);

        Ok(())
    }

    pub fn propose_admin(env: Env, new_admin: Address) {
        let current_admin = Self::admin(&env);
        current_admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::ProposedAdmin, &new_admin);
        Self::bump_instance_ttl(&env);
        env.events().publish(
            (Symbol::new(&env, "AdminProposed"), current_admin),
            new_admin,
        );
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
        env.events()
            .publish((Symbol::new(&env, "AdminTransferred"),), proposed_admin);

        Ok(())
    }

    pub fn pause(env: Env) {
        Self::admin(&env).require_auth();

        env.storage().instance().set(&DataKey::Paused, &true);
        Self::bump_instance_ttl(&env);
        env.events().publish((symbol_short!("Paused"),), ());
    }

    pub fn unpause(env: Env) {
        Self::admin(&env).require_auth();

        env.storage().instance().set(&DataKey::Paused, &false);
        Self::bump_instance_ttl(&env);
        env.events().publish((symbol_short!("Unpaused"),), ());
    }

    pub fn get_pool_stats(env: Env, token: Address) -> PoolStats {
        let total_deposits = Self::total_deposits(&env, &token);
        let token_client = TokenClient::new(&env, &token);
        let pool_token_balance = token_client.balance(&env.current_contract_address());

        let utilization_bps = if total_deposits > 0 {
            let borrowed = total_deposits - pool_token_balance;
            let borrowed_bps = (borrowed * 10000) / total_deposits;
            borrowed_bps as u32
        } else {
            0
        };

        PoolStats {
            total_deposits,
            pool_token_balance,
            depositor_count: Self::read_depositor_count(&env, &token),
            utilization_bps,
        }
    }
}

#[cfg(test)]
mod test;
