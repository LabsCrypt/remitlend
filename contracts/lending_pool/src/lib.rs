#![no_std]

use soroban_sdk::{contract, contractimpl, Address, Env, Event};
use soroban_sdk::{contract, contractimpl, Address, Env};

#[contract]
pub struct LendingPool;

#[contractimpl]
impl LendingPool {
    pub fn deposit(env: Env, provider: Address, amount: i128) {
        // Deposit logic

        // Emit Deposited event
        let timestamp = env.ledger().timestamp();
        env.events().publish(
            ("Deposited", provider.clone()),
            (amount, timestamp)
        );
    }

    pub fn withdraw(env: Env, provider: Address, amount: i128) {
        // Withdraw logic

        // Emit Withdrawn event
        let timestamp = env.ledger().timestamp();
        env.events().publish(
            ("Withdrawn", provider.clone()),
            (amount, timestamp)
        );
    }
}
