use soroban_sdk::{symbol_short, Address, Env, String, Symbol};

pub fn loan_requested(env: &Env, borrower: Address, amount: i128) {
    let topics = (Symbol::new(env, "LoanRequested"), borrower);
    env.events().publish(topics, amount);
}

pub fn loan_approved(env: &Env, loan_id: u32, borrower: Address) {
    let topics = (Symbol::new(env, "LoanApproved"), loan_id);
    env.events().publish(topics, borrower);
}

pub fn loan_refinanced(
    env: &Env,
    loan_id: u32,
    borrower: Address,
    new_amount: i128,
    new_term: u32,
) {
    let topics = (Symbol::new(env, "LoanRefinanced"), loan_id, borrower);
    env.events().publish(topics, (new_amount, new_term));
}

pub fn loan_repaid(env: &Env, borrower: Address, loan_id: u32, amount: i128) {
    let topics = (Symbol::new(env, "LoanRepaid"), borrower, loan_id);
    env.events().publish(topics, amount);
}

pub fn loan_cancelled(env: &Env, borrower: Address, loan_id: u32) {
    let topics = (Symbol::new(env, "LoanCancelled"), borrower);
    env.events().publish(topics, loan_id);
}

pub fn loan_rejected(env: &Env, loan_id: u32, reason: String) {
    let topics = (Symbol::new(env, "LoanRejected"), loan_id);
    env.events().publish(topics, reason);
}

pub fn late_fee_charged(env: &Env, loan_id: u32, fee_amount: i128) {
    let topics = (Symbol::new(env, "LateFeeCharged"), loan_id);
    env.events().publish(topics, fee_amount);
}

pub fn min_score_updated(env: &Env, old_score: u32, new_score: u32) {
    env.events()
        .publish((symbol_short!("MinScore"),), (old_score, new_score));
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

pub fn interest_rate_updated(env: &Env, old_rate: u32, new_rate: u32) {
    let topics = (Symbol::new(env, "InterestRateUpdated"),);
    env.events().publish(topics, (old_rate, new_rate));
}

pub fn default_term_updated(env: &Env, old_term: u32, new_term: u32) {
    let topics = (Symbol::new(env, "DefaultTermUpdated"),);
    env.events().publish(topics, (old_term, new_term));
}

pub fn loan_defaulted(env: &Env, loan_id: u32, borrower: Address) {
    let topics = (Symbol::new(env, "LoanDefaulted"), loan_id);
    env.events().publish(topics, borrower);
}

pub fn term_limits_updated(env: &Env, min_term: u32, max_term: u32) {
    let topics = (Symbol::new(env, "TermLimitsUpdated"),);
    env.events().publish(topics, (min_term, max_term));
}

pub fn rate_oracle_updated(env: &Env, old_oracle: Option<Address>, new_oracle: Address) {
    let topics = (Symbol::new(env, "RateOracleUpdated"),);
    env.events().publish(topics, (old_oracle, new_oracle));
}

pub fn late_fee_rate_updated(env: &Env, admin: Address, old_rate: u32, new_rate: u32) {
    let topics = (Symbol::new(env, "LateFeeRateUpdated"), admin);
    env.events().publish(topics, (old_rate, new_rate));
}

pub fn grace_period_updated(env: &Env, admin: Address, old_ledgers: u32, new_ledgers: u32) {
    let topics = (Symbol::new(env, "GracePeriodUpdated"), admin);
    env.events().publish(topics, (old_ledgers, new_ledgers));
}

pub fn default_window_updated(env: &Env, admin: Address, old_ledgers: u32, new_ledgers: u32) {
    let topics = (Symbol::new(env, "DefaultWindowUpdated"), admin);
    env.events().publish(topics, (old_ledgers, new_ledgers));
}

pub fn max_loan_amount_updated(env: &Env, admin: Address, old_amount: i128, new_amount: i128) {
    let topics = (Symbol::new(env, "MaxLoanAmountUpdated"), admin);
    env.events().publish(topics, (old_amount, new_amount));
}

pub fn min_repayment_updated(env: &Env, admin: Address, old_amount: i128, new_amount: i128) {
    let topics = (Symbol::new(env, "MinRepaymentUpdated"), admin);
    env.events().publish(topics, (old_amount, new_amount));
}

pub fn max_loans_per_borrower_updated(env: &Env, admin: Address, old_max: u32, new_max: u32) {
    let topics = (Symbol::new(env, "MaxLoansPerBorrower"), admin);
    env.events().publish(topics, (old_max, new_max));
}

pub fn loan_approved_by_admin(env: &Env, admin: Address, loan_id: u32, borrower: Address) {
    let topics = (symbol_short!("LoanApprv"), admin);
    env.events().publish(topics, (loan_id, borrower));
}
