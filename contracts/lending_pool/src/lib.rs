#![no_std]
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, Symbol,
};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Deposit(Address),
    Admin,
    Paused,
    RewardDebt(Address),
    ClaimableYield(Address),
    MaxPoolSize,
    TotalDeposits,
    DepositorCount,
    AccYieldPerDeposit,
    UnclaimedYieldPool,
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
    const CURRENT_VERSION: u32 = 1;
    const YIELD_SCALE: i128 = 1_000_000_000;

    fn token_key() -> soroban_sdk::Symbol {
        symbol_short!("TOKEN")
    }

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

    fn read_token(env: &Env) -> Address {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&Self::token_key())
            .expect("not initialized")
    }

    fn admin(env: &Env) -> Address {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    fn pool_balance(env: &Env) -> i128 {
        let token = Self::read_token(env);
        let token_client = TokenClient::new(env, &token);
        token_client.balance(&env.current_contract_address())
    }

    fn total_deposits(env: &Env) -> i128 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::TotalDeposits)
            .unwrap_or(0)
    }

    fn acc_yield_per_deposit(env: &Env) -> i128 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::AccYieldPerDeposit)
            .unwrap_or(0)
    }

    fn unclaimed_yield_pool(env: &Env) -> i128 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::UnclaimedYieldPool)
            .unwrap_or(0)
    }

    fn read_deposit(env: &Env, provider: &Address) -> i128 {
        let key = DataKey::Deposit(provider.clone());
        let balance = env.storage().persistent().get(&key).unwrap_or(0);
        if balance > 0 {
            Self::bump_persistent_ttl(env, &key);
        }
        balance
    }

    fn read_reward_debt(env: &Env, provider: &Address) -> i128 {
        let key = DataKey::RewardDebt(provider.clone());
        let debt = env.storage().persistent().get(&key).unwrap_or(0);
        if debt != 0 {
            Self::bump_persistent_ttl(env, &key);
        }
        debt
    }

    fn read_claimable_yield(env: &Env, provider: &Address) -> i128 {
        let key = DataKey::ClaimableYield(provider.clone());
        let claimable = env.storage().persistent().get(&key).unwrap_or(0);
        if claimable > 0 {
            Self::bump_persistent_ttl(env, &key);
        }
        claimable
    }

    fn write_reward_debt(env: &Env, provider: &Address, amount: i128) {
        let key = DataKey::RewardDebt(provider.clone());
        if amount == 0 {
            env.storage().persistent().remove(&key);
            return;
        }
        env.storage().persistent().set(&key, &amount);
        Self::bump_persistent_ttl(env, &key);
    }

    fn write_claimable_yield(env: &Env, provider: &Address, amount: i128) {
        let key = DataKey::ClaimableYield(provider.clone());
        if amount == 0 {
            env.storage().persistent().remove(&key);
            return;
        }
        env.storage().persistent().set(&key, &amount);
        Self::bump_persistent_ttl(env, &key);
    }

    fn sync_yield(env: &Env) {
        let total_deposits = Self::total_deposits(env);
        if total_deposits <= 0 {
            return;
        }

        let pool_balance = Self::pool_balance(env);
        let current_excess = if pool_balance > total_deposits {
            pool_balance - total_deposits
        } else {
            0
        };
        let accounted_yield = Self::unclaimed_yield_pool(env);

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

        let next_index = Self::acc_yield_per_deposit(env)
            .checked_add(increment)
            .expect("yield index overflow");
        let next_unclaimed = accounted_yield
            .checked_add(new_yield)
            .expect("yield pool overflow");

        env.storage()
            .instance()
            .set(&DataKey::AccYieldPerDeposit, &next_index);
        env.storage()
            .instance()
            .set(&DataKey::UnclaimedYieldPool, &next_unclaimed);
        Self::bump_instance_ttl(env);

        env.events().publish(
            (Symbol::new(env, "YieldSynced"),),
            (new_yield, total_deposits, next_index),
        );
    }

    fn harvest_provider(env: &Env, provider: &Address) {
        let deposit = Self::read_deposit(env, provider);
        if deposit <= 0 {
            return;
        }

        let accrued = deposit
            .checked_mul(Self::acc_yield_per_deposit(env))
            .and_then(|value| value.checked_div(Self::YIELD_SCALE))
            .expect("yield accrual overflow");
        let reward_debt = Self::read_reward_debt(env, provider);
        let pending = accrued
            .checked_sub(reward_debt)
            .expect("reward debt exceeds accrued yield");

        if pending > 0 {
            let claimable = Self::read_claimable_yield(env, provider)
                .checked_add(pending)
                .expect("claimable yield overflow");
            Self::write_claimable_yield(env, provider, claimable);
        }

        Self::write_reward_debt(env, provider, accrued);
    }

    fn assert_not_paused(env: &Env) {
        Self::bump_instance_ttl(env);
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            panic!("contract is paused");
        }
    }

    fn read_depositor_count(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::DepositorCount)
            .unwrap_or(0)
    }

    pub fn initialize(env: Env, token: Address, admin: Address) {
        let token_key = Self::token_key();
        if env.storage().instance().has(&token_key) {
            panic!("already initialized");
        }
        env.storage().instance().set(&token_key, &token);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage()
            .instance()
            .set(&DataKey::TotalDeposits, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::DepositorCount, &0_u32);
        env.storage().instance().set(&DataKey::MaxPoolSize, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::AccYieldPerDeposit, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::UnclaimedYieldPool, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::Version, &Self::CURRENT_VERSION);
        Self::bump_instance_ttl(&env);
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

    pub fn migrate(env: Env) {
        Self::admin(&env).require_auth();

        if !env.storage().instance().has(&DataKey::TotalDeposits) {
            env.storage()
                .instance()
                .set(&DataKey::TotalDeposits, &0i128);
        }
        if !env.storage().instance().has(&DataKey::MaxPoolSize) {
            env.storage().instance().set(&DataKey::MaxPoolSize, &0i128);
        }
        if !env.storage().instance().has(&DataKey::AccYieldPerDeposit) {
            env.storage()
                .instance()
                .set(&DataKey::AccYieldPerDeposit, &0i128);
        }
        if !env.storage().instance().has(&DataKey::UnclaimedYieldPool) {
            env.storage()
                .instance()
                .set(&DataKey::UnclaimedYieldPool, &0i128);
        }
        if !env.storage().instance().has(&DataKey::DepositorCount) {
            env.storage()
                .instance()
                .set(&DataKey::DepositorCount, &0_u32);
        }
        env.storage()
            .instance()
            .set(&DataKey::Version, &Self::CURRENT_VERSION);

        Self::bump_instance_ttl(&env);
    }

    pub fn set_max_pool_size(env: Env, max: i128) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        if max < 0 {
            panic!("max pool size must be non-negative");
        }
        env.storage().instance().set(&DataKey::MaxPoolSize, &max);
        Self::bump_instance_ttl(&env);
        env.events().publish((symbol_short!("MaxPool"),), max);
    }

    pub fn get_max_pool_size(env: Env) -> i128 {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::MaxPoolSize)
            .unwrap_or(0)
    }

    pub fn get_total_deposits(env: Env) -> i128 {
        Self::total_deposits(&env)
    }

    pub fn deposit(env: Env, provider: Address, amount: i128) {
        provider.require_auth();
        Self::assert_not_paused(&env);

        if amount <= 0 {
            panic!("deposit amount must be positive");
        }

        let max: i128 = env
            .storage()
            .instance()
            .get(&DataKey::MaxPoolSize)
            .unwrap_or(0);
        if max > 0 {
            let total = Self::total_deposits(&env);
            if total.checked_add(amount).expect("overflow") > max {
                panic!("deposit exceeds max pool size");
            }
        }

        Self::sync_yield(&env);
        Self::harvest_provider(&env, &provider);

        let token = Self::read_token(&env);
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&provider, &env.current_contract_address(), &amount);

        let key = DataKey::Deposit(provider.clone());
        let current_balance = Self::read_deposit(&env, &provider);

        if current_balance == 0 {
            let count = Self::read_depositor_count(&env);
            env.storage()
                .instance()
                .set(&DataKey::DepositorCount, &(count + 1));
        }

        let next_balance = current_balance
            .checked_add(amount)
            .expect("deposit overflow");
        env.storage().persistent().set(&key, &next_balance);
        Self::bump_persistent_ttl(&env, &key);

        let total_deposits = Self::total_deposits(&env)
            .checked_add(amount)
            .expect("total deposits overflow");
        env.storage()
            .instance()
            .set(&DataKey::TotalDeposits, &total_deposits);
        Self::bump_instance_ttl(&env);

        let reward_debt = next_balance
            .checked_mul(Self::acc_yield_per_deposit(&env))
            .and_then(|value| value.checked_div(Self::YIELD_SCALE))
            .expect("reward debt overflow");
        Self::write_reward_debt(&env, &provider, reward_debt);
        env.events()
            .publish((symbol_short!("Deposit"), provider), amount);
    }

    pub fn get_deposit(env: Env, provider: Address) -> i128 {
        Self::read_deposit(&env, &provider)
    }

    pub fn withdraw(env: Env, provider: Address, amount: i128) {
        provider.require_auth();
        Self::assert_not_paused(&env);

        if amount <= 0 {
            panic!("withdraw amount must be positive");
        }

        Self::sync_yield(&env);
        Self::harvest_provider(&env, &provider);

        let key = DataKey::Deposit(provider.clone());
        let current_balance = Self::read_deposit(&env, &provider);
        if current_balance < amount {
            panic!("insufficient balance");
        }
        let token = Self::read_token(&env);
        let token_client = TokenClient::new(&env, &token);
        let pool_address = env.current_contract_address();
        let pool_balance = token_client.balance(&pool_address);
        if pool_balance < amount {
            panic!("insufficient pool liquidity");
        }
        let remaining_pool_balance = pool_balance
            .checked_sub(amount)
            .expect("withdraw underflow");
        if remaining_pool_balance < Self::unclaimed_yield_pool(&env) {
            panic!("insufficient pool liquidity");
        }
        token_client.transfer(&pool_address, &provider, &amount);

        let new_balance = current_balance
            .checked_sub(amount)
            .expect("withdraw underflow");
        if new_balance == 0 {
            env.storage().persistent().remove(&key);
            env.storage()
                .persistent()
                .remove(&DataKey::RewardDebt(provider.clone()));

            let count = Self::read_depositor_count(&env);
            env.storage()
                .instance()
                .set(&DataKey::DepositorCount, &count.saturating_sub(1));
        } else {
            env.storage().persistent().set(&key, &new_balance);
            Self::bump_persistent_ttl(&env, &key);
            let reward_debt = new_balance
                .checked_mul(Self::acc_yield_per_deposit(&env))
                .and_then(|value| value.checked_div(Self::YIELD_SCALE))
                .expect("reward debt overflow");
            Self::write_reward_debt(&env, &provider, reward_debt);
        }

        let total_deposits = Self::total_deposits(&env)
            .checked_sub(amount)
            .expect("total deposits underflow");
        env.storage()
            .instance()
            .set(&DataKey::TotalDeposits, &total_deposits);
        Self::bump_instance_ttl(&env);

        env.events()
            .publish((symbol_short!("Withdraw"), provider), amount);
    }

    pub fn claim_yield(env: Env, provider: Address) {
        provider.require_auth();
        Self::assert_not_paused(&env);

        Self::sync_yield(&env);
        Self::harvest_provider(&env, &provider);

        let claimable = Self::read_claimable_yield(&env, &provider);
        if claimable <= 0 {
            env.events().publish(
                (Symbol::new(&env, "YieldClaimFailed"), provider),
                Symbol::new(&env, "NoYieldAvailable"),
            );
            return;
        }

        let pool_balance = Self::pool_balance(&env);
        let total_deposits = Self::total_deposits(&env);
        let available_yield = if pool_balance > total_deposits {
            pool_balance - total_deposits
        } else {
            0
        };
        if available_yield < claimable {
            panic!("insufficient realized yield liquidity");
        }

        let token = Self::read_token(&env);
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &provider, &claimable);

        Self::write_claimable_yield(&env, &provider, 0);
        let remaining_unclaimed = Self::unclaimed_yield_pool(&env)
            .checked_sub(claimable)
            .expect("unclaimed yield underflow");
        env.storage()
            .instance()
            .set(&DataKey::UnclaimedYieldPool, &remaining_unclaimed);
        Self::bump_instance_ttl(&env);

        env.events()
            .publish((Symbol::new(&env, "YieldClaimed"), provider), claimable);
    }

    pub fn get_token(env: Env) -> Address {
        Self::read_token(&env)
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

    pub fn accept_admin(env: Env) {
        let proposed_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::ProposedAdmin)
            .expect("no proposed admin");
        proposed_admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::Admin, &proposed_admin);
        env.storage().instance().remove(&DataKey::ProposedAdmin);
        Self::bump_instance_ttl(&env);
        env.events()
            .publish((Symbol::new(&env, "AdminTransferred"),), proposed_admin);
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

    pub fn get_pool_stats(env: Env) -> PoolStats {
        let total_deposits = Self::total_deposits(&env);
        let token: Address = Self::read_token(&env);
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
            depositor_count: Self::read_depositor_count(&env),
            utilization_bps,
        }
    }
}

#[cfg(test)]
mod test;
