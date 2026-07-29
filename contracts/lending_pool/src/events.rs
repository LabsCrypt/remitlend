use crate::DataKey;
use soroban_sdk::{Address, Env, Symbol};

pub fn deposit(env: &Env, provider: Address, token: Address, amount: i128, shares_minted: i128) {
    let topics = (Symbol::new(env, "Deposit"), provider, token);
    env.events().publish(topics, (amount, shares_minted));
}

pub fn withdraw(env: &Env, provider: Address, token: Address, amount: i128, shares_burned: i128) {
    let topics = (Symbol::new(env, "Withdraw"), provider, token);
    env.events().publish(topics, (amount, shares_burned));
}

pub fn emergency_withdraw(env: &Env, provider: Address, token: Address, shares_burned: i128) {
    let topics = (Symbol::new(env, "EmergencyWithdraw"), provider, token);
    env.events().publish(topics, shares_burned);
}

#[allow(dead_code)]
pub fn yield_distributed(env: &Env, token: Address, amount: i128) {
    if amount > 0 {
        let total = env
            .storage()
            .instance()
            .get::<_, i128>(&DataKey::TotalYieldDistributed(token.clone()))
            .unwrap_or(0)
            .checked_add(amount)
            .expect("total yield distributed overflow");
        env.storage()
            .instance()
            .set(&DataKey::TotalYieldDistributed(token.clone()), &total);
    }

    let topics = (Symbol::new(env, "YieldDistributed"), token);
    env.events().publish(topics, amount);
}

pub fn deposit_cap_updated(env: &Env, token: Address, old_cap: i128, new_cap: i128) {
    let topics = (Symbol::new(env, "DepositCapUpdated"), token);
    env.events().publish(topics, (old_cap, new_cap));
}

pub fn pool_paused(env: &Env) {
    let topics = (Symbol::new(env, "PoolPaused"),);
    env.events().publish(topics, ());
}

pub fn pool_unpaused(env: &Env) {
    let topics = (Symbol::new(env, "PoolUnpaused"),);
    env.events().publish(topics, ());
}

pub fn withdrawal_cooldown_updated(env: &Env, old_cooldown: u32, new_cooldown: u32) {
    let topics = (Symbol::new(env, "WithdrawalCooldownUpdated"),);
    env.events().publish(topics, (old_cooldown, new_cooldown));
}

pub fn admin_proposed(env: &Env, current_admin: Address, proposed_admin: Address) {
    let topics = (Symbol::new(env, "AdminProposed"), current_admin);
    env.events().publish(topics, proposed_admin);
}

pub fn admin_transferred(env: &Env, previous_admin: Address, new_admin: Address, via: Symbol) {
    let topics = (Symbol::new(env, "AdminTransferred"), via);
    env.events().publish(topics, (previous_admin, new_admin));
}
