#![cfg_attr(not(test), no_std)]
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Deposit(Address),
}

#[contract]
pub struct LendingPool;

#[contractimpl]
impl LendingPool {
    fn token_key() -> soroban_sdk::Symbol {
        symbol_short!("TOKEN")
    }

    fn read_token(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&Self::token_key())
            .expect("not initialized")
    }

    pub fn initialize(env: Env, token: Address) {
        let token_key = Self::token_key();
        if env.storage().instance().has(&token_key) {
            panic!("already initialized");
        }
        env.storage().instance().set(&token_key, &token);
    }

    pub fn deposit(env: Env, provider: Address, amount: i128) {
        provider.require_auth();
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
        env.events()
            .publish((symbol_short!("Deposit"), provider), amount);
    }

    pub fn get_deposit(env: Env, provider: Address) -> i128 {
        let key = DataKey::Deposit(provider);
        env.storage().persistent().get(&key).unwrap_or(0)
    }

    pub fn withdraw(env: Env, provider: Address, amount: i128) {
        provider.require_auth();
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
        token_client.transfer(&env.current_contract_address(), &provider, &amount);
        let new_balance = current_balance - amount;
        if new_balance == 0 {
            env.storage().persistent().remove(&key);
        } else {
            env.storage().persistent().set(&key, &new_balance);
        }
        env.events()
            .publish((symbol_short!("Withdraw"), provider), amount);
    }

    pub fn get_token(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&Self::token_key())
            .expect("not initialized")
    }
}

#[cfg(test)]
mod test;
