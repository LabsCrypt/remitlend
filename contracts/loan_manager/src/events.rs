use soroban_sdk::{Address, Env, Symbol};

pub fn loan_requested(env: &Env, borrower: Address, amount: i128) {
    let topics = (Symbol::new(env, "LoanRequested"), borrower);
    env.events().publish(topics, amount);
}

pub fn loan_approved(env: &Env, loan_id: u32) {
    let topics = (Symbol::new(env, "LoanApproved"), loan_id);
    env.events().publish(topics, ());
}

pub fn loan_repaid(env: &Env, borrower: Address, amount: i128) {
    let topics = (Symbol::new(env, "LoanRepaid"), borrower);
    env.events().publish(topics, amount);
}
