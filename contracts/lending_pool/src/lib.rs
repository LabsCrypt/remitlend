#![no_std]
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Deposit(Address),
    Admin,
    Paused,
    MaxPoolSize,
    TotalDeposits,
    DepositorCount,
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

    fn read_total_deposits(env: &Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalDeposits)
            .unwrap_or(0)
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
            .set(&DataKey::TotalDeposits, &0_i128);
        env.storage().instance().set(&DataKey::DepositorCount, &0_u32);
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
        Self::bump_instance_ttl(&env);
        Self::read_total_deposits(&env)
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
            let total = Self::read_total_deposits(&env);
            if total.checked_add(amount).expect("overflow") > max {
                panic!("deposit exceeds max pool size");
            }
        }

        let token = Self::read_token(&env);
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&provider, &env.current_contract_address(), &amount);

        let key = DataKey::Deposit(provider.clone());
        let mut current_balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);

        if current_balance == 0 {
            let count = Self::read_depositor_count(&env);
            env.storage()
                .instance()
                .set(&DataKey::DepositorCount, &(count + 1));
        }

        current_balance = current_balance
            .checked_add(amount)
            .expect("deposit overflow");
        env.storage().persistent().set(&key, &current_balance);
        Self::bump_persistent_ttl(&env, &key);

        let new_total = Self::read_total_deposits(&env)
            .checked_add(amount)
            .expect("total deposits overflow");
        env.storage()
            .instance()
            .set(&DataKey::TotalDeposits, &new_total);
        Self::bump_instance_ttl(&env);

        env.events()
            .publish((symbol_short!("Deposit"), provider), amount);
    }

    pub fn get_deposit(env: Env, provider: Address) -> i128 {
        let key = DataKey::Deposit(provider);
        let balance = env.storage().persistent().get(&key).unwrap_or(0);
        if balance > 0 {
            Self::bump_persistent_ttl(&env, &key);
        }
        balance
    }

    pub fn withdraw(env: Env, provider: Address, amount: i128) {
        provider.require_auth();
        Self::assert_not_paused(&env);

        if amount <= 0 {
            panic!("withdraw amount must be positive");
        }
        let key = DataKey::Deposit(provider.clone());
        let current_balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
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
        token_client.transfer(&pool_address, &provider, &amount);

        let new_balance = current_balance
            .checked_sub(amount)
            .expect("withdraw underflow");
        if new_balance == 0 {
            env.storage().persistent().remove(&key);
            let count = Self::read_depositor_count(&env);
            env.storage()
                .instance()
                .set(&DataKey::DepositorCount, &count.saturating_sub(1));
        } else {
            env.storage().persistent().set(&key, &new_balance);
            Self::bump_persistent_ttl(&env, &key);
        }

        let new_total = Self::read_total_deposits(&env)
            .checked_sub(amount)
            .expect("total deposits underflow");
        env.storage()
            .instance()
            .set(&DataKey::TotalDeposits, &new_total);
        Self::bump_instance_ttl(&env);

        env.events()
            .publish((symbol_short!("Withdraw"), provider), amount);
    }

    pub fn get_token(env: Env) -> Address {
        Self::read_token(&env)
    }

    pub fn pause(env: Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        env.storage().instance().set(&DataKey::Paused, &true);
        Self::bump_instance_ttl(&env);
        env.events().publish((symbol_short!("Paused"),), ());
    }

    pub fn unpause(env: Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        env.storage().instance().set(&DataKey::Paused, &false);
        Self::bump_instance_ttl(&env);
        env.events().publish((symbol_short!("Unpaused"),), ());
    }

    pub fn get_pool_stats(env: Env) -> PoolStats {
        let total_deposits = Self::read_total_deposits(&env);
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
