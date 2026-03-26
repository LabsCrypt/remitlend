use soroban_sdk::{symbol_short, Address, Env, Symbol};

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

pub(crate) fn fee_collected(env: &Env, loan_id: u32, amount: i128, treasury: Address) {
    env.events()
        .publish((symbol_short!("FeeCollct"), loan_id), (amount, treasury));
}

// pub fn min_score_updated(env: &Env, old_score: u32, new_score: u32) {
//     let topics = (Symbol::new(env, "MinScoreUpdated"),);
//     env.events().publish(topics, (old_score, new_score));
// }

// ── New extension events ───────────────────────────────────────────────────────

// Emitted when a borrower is granted a loan extension.
//
// Topic:   ("LoanExt", borrower)
// Data:    (loan_id, old_due_date, new_due_date, fee_charged,
//           new_interest_rate_bps, extension_count)
//
// Indexers can use this to:
// - Track how many times each loan has been extended.
// - Calculate the total fees collected from extensions.
// - Alert borrowers whose rate is approaching usury limits.
// #[allow(clippy::too_many_arguments)]
// pub fn loan_extended(
//     env: &Env,
//     borrower: Address,
//     loan_id: u32,
//     old_due_date: u32,
//     new_due_date: u32,
//     fee_charged: i128,
//     new_interest_rate_bps: u32,
//     extension_count: u32,
// ) {
//     env.events().publish(
//         (symbol_short!("LoanExt"), borrower),
//         (
//             loan_id,
//             old_due_date,
//             new_due_date,
//             fee_charged,
//             new_interest_rate_bps,
//             extension_count,
//         ),
//     );
// }

// Emitted when the admin updates the extension configuration.
//
// Topic:   ("ExtConf",)
// Data:    (fee, interest_rate_bps, max_extensions, term_ledgers)
// pub fn extension_config_updated(
//     env: &Env,
//     fee: i128,
//     interest_rate_bps: u32,
//     max_extensions: u32,
//     term_ledgers: u32,
// ) {
//     env.events().publish(
//         (symbol_short!("ExtConf"),),
//         (fee, interest_rate_bps, max_extensions, term_ledgers),
//     );
// }

pub fn loan_defaulted(env: &Env, loan_id: u32, borrower: Address) {
    let topics = (Symbol::new(env, "LoanDefaulted"), loan_id);
    env.events().publish(topics, borrower);
}
