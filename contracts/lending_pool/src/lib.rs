#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env};
use soroban_sdk::token::Client as TokenClient;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Token,
    Deposit(Address),
}

#[contract]
pub struct LendingPool;

#[contractimpl]
impl LendingPool {
    pub fn initialize(env: Env, token: Address) {
        if env.storage().instance().has(&DataKey::Token) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Token, &token);
    }

    pub fn deposit(env: Env, provider: Address, amount: i128) {
        provider.require_auth();
        if amount <= 0 {
            panic!("deposit amount must be positive");
        }
        let token: Address = env.storage().instance().get(&DataKey::Token).expect("not initialized");
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&provider, &env.current_contract_address(), &amount);
        let key = DataKey::Deposit(provider.clone());
        let mut current_balance: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        current_balance += amount;
        env.storage().persistent().set(&key, &current_balance);
        env.events().publish((symbol_short!("Deposit"), provider), amount);
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
        let token: Address = env.storage().instance().get(&DataKey::Token).expect("not initialized");
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &provider, &amount);
        env.storage().persistent().set(&key, &(current_balance - amount));
        env.events().publish((symbol_short!("Withdraw"), provider), amount);
    }
}

#[cfg(test)]
mod test;
