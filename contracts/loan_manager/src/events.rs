use soroban_sdk::{Address, Env, Symbol};

pub fn loan_requested(env: &Env, borrower: Address, amount: i128) {
    let topics = (Symbol::new(env, "LoanRequested"), borrower);
    env.events().publish(topics, amount);
}

pub fn loan_approved(env: &Env, loan_id: u32) {
    let topics = (Symbol::new(env, "LoanApproved"), loan_id);
    env.events().publish(topics, ());
}

pub fn loan_repaid(env: &Env, borrower: Address, loan_id: u32, amount: i128) {
    let topics = (Symbol::new(env, "LoanRepaid"), borrower, loan_id);
    env.events().publish(topics, amount);
}

pub fn paused(env: &Env) {
    let topics = (Symbol::new(env, "Paused"),);
    env.events().publish(topics, ());
}

pub fn unpaused(env: &Env) {
    let topics = (Symbol::new(env, "Unpaused"),);
    env.events().publish(topics, ());
}

pub fn min_score_updated(env: &Env, old_score: u32, new_score: u32) {
    let topics = (Symbol::new(env, "MinScoreUpdated"),);
    env.events().publish(topics, (old_score, new_score));
}

pub fn loan_defaulted(env: &Env, loan_id: u32, borrower: Address) {
    let topics = (Symbol::new(env, "LoanDefaulted"), loan_id);
    env.events().publish(topics, borrower);
}
