#![no_std]
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Deposit(Address),
    Admin,
    Paused,
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

    pub fn initialize(env: Env, token: Address, admin: Address) {
        let token_key = Self::token_key();
        if env.storage().instance().has(&token_key) {
            panic!("already initialized");
        }
        env.storage().instance().set(&token_key, &token);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
        Self::bump_instance_ttl(&env);
    }

    pub fn deposit(env: Env, provider: Address, amount: i128) {
        provider.require_auth();
        Self::assert_not_paused(&env);

        if amount <= 0 {
            panic!("deposit amount must be positive");
        }
        let token = Self::read_token(&env);
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&provider, &env.current_contract_address(), &amount);
        let key = DataKey::Deposit(provider.clone());
        let mut current_balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        current_balance = current_balance
            .checked_add(amount)
            .expect("deposit overflow");
        env.storage().persistent().set(&key, &current_balance);
        Self::bump_persistent_ttl(&env, &key);
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
        } else {
            env.storage().persistent().set(&key, &new_balance);
            Self::bump_persistent_ttl(&env, &key);
        }
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
}

#[cfg(test)]
mod test;
