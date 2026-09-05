//! Event emission module for the `loan_manager` contract.
//!
//! This module defines all event emitters published by the `loan_manager` contract.
//! Indexers and off-chain service listeners rely on these schemas for tracking on-chain state changes.
//!
//! # Event Catalog
//!
//! | Event | Topics (`Topic 0`, `Topic 1`, ...) | Data Payload |
//! |---|---|---|
//! | `LoanRequested` | `("LoanRequested", loan_id: u32, borrower: Address)` | `amount: i128` |
//! | `LoanApproved` | `("LoanApproved", loan_id: u32, borrower: Address)` | `(interest_rate_bps: u32, term_ledgers: u32)` |
//! | `LoanRefinanced` | `("LoanRefinanced", loan_id: u32, borrower: Address)` | `(new_amount: i128, new_term: u32)` |
//! | `LoanExtended` | `("LoanExtended", loan_id: u32, borrower: Address)` | `(new_due_ledger: u32, fee_amount: i128, extension_count: u32)` |
//! | `LoanRepaid` | `("LoanRepaid", borrower: Address, loan_id: u32)` | `amount: i128` |
//! | `LoanCancelled` | `("LoanCancelled", borrower: Address)` | `loan_id: u32` |
//! | `LoanRejected` | `("LoanRejected", loan_id: u32)` | `reason: String` |
//! | `LateFeeCharged` | `("LateFeeCharged", loan_id: u32)` | `fee_amount: i128` |
//! | `MinScoreUpdated` | `("MinScoreUpdated", admin: Address)` | `(old_score: u32, new_score: u32)` |
//! | `Paused` | `("Paused",)` | `paused_at_ledger: u32` |
//! | `Unpaused` | `("Unpaused",)` | `unpaused_at_ledger: u32` |
//! | `InterestRateUpdated` | `("InterestRateUpdated",)` | `(old_rate: u32, new_rate: u32)` |
//! | `DefaultTermUpdated` | `("DefaultTermUpdated",)` | `(old_term: u32, new_term: u32)` |
//! | `LoanDefaulted` | `("LoanDefaulted", loan_id: u32)` | `borrower: Address` |
//! | `TermLimitsUpdated` | `("TermLimitsUpdated",)` | `(min_term: u32, max_term: u32)` |
//! | `RateOracleUpdated` | `("RateOracleUpdated",)` | `(old_oracle: Option<Address>, new_oracle: Address)` |
//! | `CollateralReturned` | `("CollateralReturned", borrower: Address, loan_id: u32)` | `amount: i128` |
//! | `CollateralDeposited` | `("CollateralDeposited", borrower: Address, loan_id: u32)` | `amount: i128` |
//! | `CollateralReleased` | `("CollateralReleased", borrower: Address, loan_id: u32)` | `()` |
//! | `LateFeeRateUpdated` | `("LateFeeRateUpdated", admin: Address)` | `(old_rate: u32, new_rate: u32)` |
//! | `GracePeriodUpdated` | `("GracePeriodUpdated", admin: Address)` | `(old_ledgers: u32, new_ledgers: u32)` |
//! | `DefaultWindowUpdated` | `("DefaultWindowUpdated", admin: Address)` | `(old_ledgers: u32, new_ledgers: u32)` |
//! | `MaxLoanAmountUpdated` | `("MaxLoanAmountUpdated", admin: Address)` | `(old_amount: i128, new_amount: i128)` |
//! | `MinRepaymentUpdated` | `("MinRepaymentUpdated", admin: Address)` | `(old_amount: i128, new_amount: i128)` |
//! | `MaxLoansPerBorrower` | `("MaxLoansPerBorrower", admin: Address)` | `(old_max: u32, new_max: u32)` |
//! | `LoanApprv` | `(symbol_short!("LoanApprv"), admin: Address)` | `(loan_id: u32, borrower: Address)` |
//! | `CollateralLiquidated` | `("CollateralLiquidated", loan_id: u32)` | `amount: i128` |
//! | `LoanLiquidated` | `("LoanLiquidated", loan_id: u32, borrower: Address, liquidator: Address)` | `(debt_repaid: i128, liquidator_bonus: i128, borrower_refund: i128)` |
//! | `MinRateBpsUpdated` | `("MinRateBpsUpdated", admin: Address)` | `(old_rate: u32, new_rate: u32)` |
//! | `MaxRateBpsUpdated` | `("MaxRateBpsUpdated", admin: Address)` | `(old_rate: u32, new_rate: u32)` |
//! | `LoanPurged` | `("LoanPurged",)` | `loan_id: u32` |

use soroban_sdk::{symbol_short, Address, Env, String, Symbol};

/// Emits event when a borrower requests a new loan.
///
/// - **Topics**: `("LoanRequested", loan_id: u32, borrower: Address)`
/// - **Data**: `amount: i128`
pub fn loan_requested(env: &Env, loan_id: u32, borrower: Address, amount: i128) {
    let topics = (Symbol::new(env, "LoanRequested"), loan_id, borrower);
    env.events().publish(topics, amount);
}

/// Emits event when a pending loan is approved.
///
/// - **Topics**: `("LoanApproved", loan_id: u32, borrower: Address)`
/// - **Data**: `(interest_rate_bps: u32, term_ledgers: u32)`
///
/// # De-duplication Note
/// A single call to `approve_loan` in `lib.rs` emits **two** events:
/// 1. `LoanApproved` (emitted here with loan terms and interest rate)
/// 2. `LoanApprv` (emitted by [`loan_approved_by_admin`] with admin and borrower address)
///
///    Indexers should de-duplicate or reconcile both events.
pub fn loan_approved(
    env: &Env,
    loan_id: u32,
    borrower: Address,
    interest_rate_bps: u32,
    term_ledgers: u32,
) {
    let topics = (Symbol::new(env, "LoanApproved"), loan_id, borrower);
    env.events()
        .publish(topics, (interest_rate_bps, term_ledgers));
}

/// Emits event when an active loan is refinanced with a new principal amount or term.
///
/// - **Topics**: `("LoanRefinanced", loan_id: u32, borrower: Address)`
/// - **Data**: `(new_amount: i128, new_term: u32)`
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

/// Emits event when a loan's due date is extended.
///
/// - **Topics**: `("LoanExtended", loan_id: u32, borrower: Address)`
/// - **Data**: `(new_due_ledger: u32, fee_amount: i128, extension_count: u32)`
pub fn loan_extended(
    env: &Env,
    loan_id: u32,
    borrower: Address,
    new_due_ledger: u32,
    fee_amount: i128,
    extension_count: u32,
) {
    let topics = (Symbol::new(env, "LoanExtended"), loan_id, borrower);
    env.events()
        .publish(topics, (new_due_ledger, fee_amount, extension_count));
}

/// Emits event when a borrower repays part or all of a loan.
///
/// - **Topics**: `("LoanRepaid", borrower: Address, loan_id: u32)`
/// - **Data**: `amount: i128`
pub fn loan_repaid(env: &Env, borrower: Address, loan_id: u32, amount: i128) {
    let topics = (Symbol::new(env, "LoanRepaid"), borrower, loan_id);
    env.events().publish(topics, amount);
}

/// Emits event when a borrower cancels a pending loan request.
///
/// - **Topics**: `("LoanCancelled", borrower: Address)`
/// - **Data**: `loan_id: u32`
///
/// # Payload Quirk
/// Note that `loan_cancelled` places `loan_id` in the **data payload** (with `borrower` in topics),
/// whereas [`loan_rejected`] places `loan_id` in the **topics** (with `reason` in data).
pub fn loan_cancelled(env: &Env, borrower: Address, loan_id: u32) {
    let topics = (Symbol::new(env, "LoanCancelled"), borrower);
    env.events().publish(topics, loan_id);
}

/// Emits event when an admin rejects a pending loan request.
///
/// - **Topics**: `("LoanRejected", loan_id: u32)`
/// - **Data**: `reason: String`
///
/// # Payload Quirk
/// Note that `loan_rejected` places `loan_id` in the **topics** (with `reason` in data),
/// whereas [`loan_cancelled`] places `loan_id` in the **data payload** (with `borrower` in topics).
pub fn loan_rejected(env: &Env, loan_id: u32, reason: String) {
    let topics = (Symbol::new(env, "LoanRejected"), loan_id);
    env.events().publish(topics, reason);
}

/// Emits event when a late fee is charged to a past-due loan.
///
/// - **Topics**: `("LateFeeCharged", loan_id: u32)`
/// - **Data**: `fee_amount: i128`
pub fn late_fee_charged(env: &Env, loan_id: u32, fee_amount: i128) {
    let topics = (Symbol::new(env, "LateFeeCharged"), loan_id);
    env.events().publish(topics, fee_amount);
}

/// Emits event when minimum credit score requirement is updated by admin.
///
/// - **Topics**: `("MinScoreUpdated", admin: Address)`
/// - **Data**: `(old_score: u32, new_score: u32)`
pub fn min_score_updated(env: &Env, admin: Address, old_score: u32, new_score: u32) {
    let topics = (Symbol::new(env, "MinScoreUpdated"), admin);
    env.events().publish(topics, (old_score, new_score));
}

/// Emits event when the contract is paused.
///
/// - **Topics**: `("Paused",)`
/// - **Data**: `paused_at_ledger: u32`
pub fn paused(env: &Env, paused_at_ledger: u32) {
    let topics = (Symbol::new(env, "Paused"),);
    env.events().publish(topics, paused_at_ledger);
}

/// Emits event when the contract is unpaused.
///
/// - **Topics**: `("Unpaused",)`
/// - **Data**: `unpaused_at_ledger: u32`
pub fn unpaused(env: &Env, unpaused_at_ledger: u32) {
    let topics = (Symbol::new(env, "Unpaused"),);
    env.events().publish(topics, unpaused_at_ledger);
}

/// Emits event when the base interest rate is updated.
///
/// - **Topics**: `("InterestRateUpdated",)`
/// - **Data**: `(old_rate: u32, new_rate: u32)`
pub fn interest_rate_updated(env: &Env, old_rate: u32, new_rate: u32) {
    let topics = (Symbol::new(env, "InterestRateUpdated"),);
    env.events().publish(topics, (old_rate, new_rate));
}

/// Emits event when the default term duration is updated.
///
/// - **Topics**: `("DefaultTermUpdated",)`
/// - **Data**: `(old_term: u32, new_term: u32)`
pub fn default_term_updated(env: &Env, old_term: u32, new_term: u32) {
    let topics = (Symbol::new(env, "DefaultTermUpdated"),);
    env.events().publish(topics, (old_term, new_term));
}

/// Emits event when a loan is marked as defaulted.
///
/// - **Topics**: `("LoanDefaulted", loan_id: u32)`
/// - **Data**: `borrower: Address`
pub fn loan_defaulted(env: &Env, loan_id: u32, borrower: Address) {
    let topics = (Symbol::new(env, "LoanDefaulted"), loan_id);
    env.events().publish(topics, borrower);
}

/// Emits event when allowed loan term limits are updated.
///
/// - **Topics**: `("TermLimitsUpdated",)`
/// - **Data**: `(min_term: u32, max_term: u32)`
pub fn term_limits_updated(env: &Env, min_term: u32, max_term: u32) {
    let topics = (Symbol::new(env, "TermLimitsUpdated"),);
    env.events().publish(topics, (min_term, max_term));
}

/// Emits event when the interest rate oracle address is updated.
///
/// - **Topics**: `("RateOracleUpdated",)`
/// - **Data**: `(old_oracle: Option<Address>, new_oracle: Address)`
pub fn rate_oracle_updated(env: &Env, old_oracle: Option<Address>, new_oracle: Address) {
    let topics = (Symbol::new(env, "RateOracleUpdated"),);
    env.events().publish(topics, (old_oracle, new_oracle));
}

/// Emits event when collateral is returned to a borrower.
///
/// - **Topics**: `("CollateralReturned", borrower: Address, loan_id: u32)`
/// - **Data**: `amount: i128`
pub fn collateral_returned(env: &Env, borrower: Address, loan_id: u32, amount: i128) {
    let topics = (Symbol::new(env, "CollateralReturned"), borrower, loan_id);
    env.events().publish(topics, amount);
}

/// Emits event when collateral is deposited for a loan.
///
/// - **Topics**: `("CollateralDeposited", borrower: Address, loan_id: u32)`
/// - **Data**: `amount: i128`
pub fn collateral_deposited(env: &Env, borrower: Address, loan_id: u32, amount: i128) {
    let topics = (Symbol::new(env, "CollateralDeposited"), borrower, loan_id);
    env.events().publish(topics, amount);
}

/// Emits event when collateral is released.
///
/// - **Topics**: `("CollateralReleased", borrower: Address, loan_id: u32)`
/// - **Data**: `()`
pub fn collateral_released(env: &Env, borrower: Address, loan_id: u32) {
    let topics = (Symbol::new(env, "CollateralReleased"), borrower, loan_id);
    env.events().publish(topics, ());
}

/// Emits event when the late fee rate BPS is updated by admin.
///
/// - **Topics**: `("LateFeeRateUpdated", admin: Address)`
/// - **Data**: `(old_rate: u32, new_rate: u32)`
pub fn late_fee_rate_updated(env: &Env, admin: Address, old_rate: u32, new_rate: u32) {
    let topics = (Symbol::new(env, "LateFeeRateUpdated"), admin);
    env.events().publish(topics, (old_rate, new_rate));
}

/// Emits event when grace period ledgers setting is updated by admin.
///
/// - **Topics**: `("GracePeriodUpdated", admin: Address)`
/// - **Data**: `(old_ledgers: u32, new_ledgers: u32)`
pub fn grace_period_updated(env: &Env, admin: Address, old_ledgers: u32, new_ledgers: u32) {
    let topics = (Symbol::new(env, "GracePeriodUpdated"), admin);
    env.events().publish(topics, (old_ledgers, new_ledgers));
}

/// Emits event when default window ledgers setting is updated by admin.
///
/// - **Topics**: `("DefaultWindowUpdated", admin: Address)`
/// - **Data**: `(old_ledgers: u32, new_ledgers: u32)`
pub fn default_window_updated(env: &Env, admin: Address, old_ledgers: u32, new_ledgers: u32) {
    let topics = (Symbol::new(env, "DefaultWindowUpdated"), admin);
    env.events().publish(topics, (old_ledgers, new_ledgers));
}

/// Emits event when maximum allowed loan amount is updated by admin.
///
/// - **Topics**: `("MaxLoanAmountUpdated", admin: Address)`
/// - **Data**: `(old_amount: i128, new_amount: i128)`
pub fn max_loan_amount_updated(env: &Env, admin: Address, old_amount: i128, new_amount: i128) {
    let topics = (Symbol::new(env, "MaxLoanAmountUpdated"), admin);
    env.events().publish(topics, (old_amount, new_amount));
}

/// Emits event when minimum repayment amount is updated by admin.
///
/// - **Topics**: `("MinRepaymentUpdated", admin: Address)`
/// - **Data**: `(old_amount: i128, new_amount: i128)`
pub fn min_repayment_updated(env: &Env, admin: Address, old_amount: i128, new_amount: i128) {
    let topics = (Symbol::new(env, "MinRepaymentUpdated"), admin);
    env.events().publish(topics, (old_amount, new_amount));
}

/// Emits event when maximum loans per borrower limit is updated by admin.
///
/// - **Topics**: `("MaxLoansPerBorrower", admin: Address)`
/// - **Data**: `(old_max: u32, new_max: u32)`
pub fn max_loans_per_borrower_updated(env: &Env, admin: Address, old_max: u32, new_max: u32) {
    let topics = (Symbol::new(env, "MaxLoansPerBorrower"), admin);
    env.events().publish(topics, (old_max, new_max));
}

/// Emits admin loan approval event.
///
/// - **Topics**: `(symbol_short!("LoanApprv"), admin: Address)`
/// - **Data**: `(loan_id: u32, borrower: Address)`
///
/// # Truncation & De-duplication Quirks
/// 1. **Truncated Symbol**: Uses `symbol_short!("LoanApprv")` instead of full `Symbol::new(env, "LoanApprovedByAdmin")` due to Soroban's 9-character symbol limit for `symbol_short!`.
/// 2. **Dual Emission**: Emitted during `approve_loan` alongside [`loan_approved`]. Indexers should de-duplicate or correlate appropriately.
pub fn loan_approved_by_admin(env: &Env, admin: Address, loan_id: u32, borrower: Address) {
    let topics = (symbol_short!("LoanApprv"), admin);
    env.events().publish(topics, (loan_id, borrower));
}

/// Emits event when loan collateral is liquidated.
///
/// - **Topics**: `("CollateralLiquidated", loan_id: u32)`
/// - **Data**: `amount: i128`
pub fn collateral_liquidated(env: &Env, loan_id: u32, amount: i128) {
    let topics = (Symbol::new(env, "CollateralLiquidated"), loan_id);
    env.events().publish(topics, amount);
}

/// Emits event when a defaulted loan is liquidated.
///
/// - **Topics**: `("LoanLiquidated", loan_id: u32, borrower: Address, liquidator: Address)`
/// - **Data**: `(debt_repaid: i128, liquidator_bonus: i128, borrower_refund: i128)`
pub fn loan_liquidated(
    env: &Env,
    loan_id: u32,
    borrower: Address,
    liquidator: Address,
    debt_repaid: i128,
    liquidator_bonus: i128,
    borrower_refund: i128,
) {
    let topics = (
        Symbol::new(env, "LoanLiquidated"),
        loan_id,
        borrower,
        liquidator,
    );
    env.events()
        .publish(topics, (debt_repaid, liquidator_bonus, borrower_refund));
}

/// Emits event when minimum interest rate BPS bound is updated by admin.
///
/// - **Topics**: `("MinRateBpsUpdated", admin: Address)`
/// - **Data**: `(old_rate: u32, new_rate: u32)`
pub fn min_rate_bps_updated(env: &Env, admin: Address, old_rate: u32, new_rate: u32) {
    let topics = (Symbol::new(env, "MinRateBpsUpdated"), admin);
    env.events().publish(topics, (old_rate, new_rate));
}

/// Emits event when maximum interest rate BPS bound is updated by admin.
///
/// - **Topics**: `("MaxRateBpsUpdated", admin: Address)`
/// - **Data**: `(old_rate: u32, new_rate: u32)`
pub fn max_rate_bps_updated(env: &Env, admin: Address, old_rate: u32, new_rate: u32) {
    let topics = (Symbol::new(env, "MaxRateBpsUpdated"), admin);
    env.events().publish(topics, (old_rate, new_rate));
}

/// Emits event when a loan in a terminal state is purged from storage by admin.
///
/// - **Topics**: `("LoanPurged",)`
/// - **Data**: `loan_id: u32`
pub fn loan_purged(env: &Env, loan_id: u32) {
    let topics = (Symbol::new(env, "LoanPurged"),);
    env.events().publish(topics, loan_id);
}