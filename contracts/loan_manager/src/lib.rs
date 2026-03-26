#![no_std]
use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, symbol_short, Address, Env, Vec,
};

#[contractclient(name = "NftClient")]
pub trait RemittanceNftInterface {
    fn get_score(env: Env, user: Address) -> u32;
    fn update_score(env: Env, user: Address, repayment_amount: i128, minter: Option<Address>);
    fn seize_collateral(env: Env, user: Address, minter: Option<Address>);
    fn is_seized(env: Env, user: Address) -> bool;
    fn record_default(env: Env, user: Address, minter: Option<Address>);
}

mod events;

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum LoanStatus {
    Pending,
    Approved,
    Repaid,
    Defaulted,
}

#[contracttype]
#[derive(Clone)]
pub struct Loan {
    pub borrower: Address,
    pub amount: i128,
    pub principal_paid: i128,
    pub interest_paid: i128,
    pub accrued_interest: i128,
    pub late_fee_paid: i128,
    pub accrued_late_fee: i128,
    pub interest_rate_bps: u32,
    pub due_date: u32,
    pub last_interest_ledger: u32,
    pub last_late_fee_ledger: u32,
    pub status: LoanStatus,
    // How many extensions have been granted for this loan.
    // Capped at MaxExtensions to prevent indefinite deferral.
    pub extension_count: u32,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    NftContract,
    LendingPool,
    Token,
    Admin,
    Loan(u32),
    LoanCounter,
    MinScore,
    Paused,
    LateFeeRateBps,

    ProtocolFeeRateBps,
    TreasuryAddress,
}

#[contract]
pub struct LoanManager;

#[contractimpl]
impl LoanManager {
    const INSTANCE_TTL_THRESHOLD: u32 = 17280;
    const INSTANCE_TTL_BUMP: u32 = 518400;
    const PERSISTENT_TTL_THRESHOLD: u32 = 17280;
    const PERSISTENT_TTL_BUMP: u32 = 518400;
    const DEFAULT_INTEREST_RATE_BPS: u32 = 1200;
    const DEFAULT_TERM_LEDGERS: u32 = 17280;
    const DEFAULT_LATE_FEE_RATE_BPS: u32 = 500;
    const MAX_LATE_FEE_CAP_BPS: u32 = 2500;
    const DEFAULT_PROTOCOL_FEE_RATE_BPS: u32 = 10;

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

    // ── Private helpers ───────────────────────────────────────────────────────

    // fn get_admin(env: &Env) -> Address {
    //     env.storage()
    //         .instance()
    //         .get(&DataKey::Admin)
    //         .expect("not initialized")
    // }

    fn nft_contract(env: &Env) -> Address {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::NftContract)
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

    fn remaining_principal(loan: &Loan) -> i128 {
        loan.amount
            .checked_sub(loan.principal_paid)
            .expect("principal paid exceeds amount")
    }

    fn accrue_interest(env: &Env, loan: &mut Loan) {
        if loan.status != LoanStatus::Approved {
            return;
        }

        let current_ledger = env.ledger().sequence();
        if loan.last_interest_ledger == 0 || current_ledger <= loan.last_interest_ledger {
            return;
        }

        let remaining_principal = Self::remaining_principal(loan);
        if remaining_principal <= 0 {
            loan.last_interest_ledger = current_ledger;
            return;
        }

        let elapsed_ledgers = current_ledger - loan.last_interest_ledger;
        let interest_delta = remaining_principal
            .checked_mul(loan.interest_rate_bps as i128)
            .and_then(|value| value.checked_mul(elapsed_ledgers as i128))
            .and_then(|value| value.checked_div(10_000))
            .and_then(|value| value.checked_div(Self::DEFAULT_TERM_LEDGERS as i128))
            .expect("interest overflow");

        loan.accrued_interest = loan
            .accrued_interest
            .checked_add(interest_delta)
            .expect("interest overflow");
        loan.last_interest_ledger = current_ledger;
    }

    fn late_fee_rate_bps(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::LateFeeRateBps)
            .unwrap_or(Self::DEFAULT_LATE_FEE_RATE_BPS)
    }

    fn protocol_fee_rate_bps(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::ProtocolFeeRateBps)
            .unwrap_or(Self::DEFAULT_PROTOCOL_FEE_RATE_BPS)
    }

    fn treasury_address(env: &Env) -> Address {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::TreasuryAddress)
            .expect("treasury address not set")
    }

    fn accrue_late_fee(env: &Env, loan: &mut Loan) -> i128 {
        if loan.status != LoanStatus::Approved {
            return 0;
        }

        let current_ledger = env.ledger().sequence();
        if loan.due_date == 0 || current_ledger <= loan.due_date {
            return 0;
        }

        let late_fee_start = loan.last_late_fee_ledger.max(loan.due_date);
        if current_ledger <= late_fee_start {
            return 0;
        }

        let remaining_principal = Self::remaining_principal(loan);
        let remaining_debt = remaining_principal
            .checked_add(loan.accrued_interest)
            .expect("debt overflow");
        if remaining_debt <= 0 {
            loan.last_late_fee_ledger = current_ledger;
            return 0;
        }

        let overdue_ledgers = current_ledger - late_fee_start;
        let incremental_fee = remaining_debt
            .checked_mul(Self::late_fee_rate_bps(env) as i128)
            .and_then(|value| value.checked_mul(overdue_ledgers as i128))
            .and_then(|value| value.checked_div(10_000))
            .and_then(|value| value.checked_div(Self::DEFAULT_TERM_LEDGERS as i128))
            .expect("late fee overflow");

        let fee_cap = loan
            .amount
            .checked_mul(Self::MAX_LATE_FEE_CAP_BPS as i128)
            .and_then(|value| value.checked_div(10_000))
            .expect("late fee overflow");
        let total_late_fees = loan
            .accrued_late_fee
            .checked_add(loan.late_fee_paid)
            .expect("late fee overflow");
        let remaining_fee_capacity = fee_cap.checked_sub(total_late_fees).unwrap_or(0);

        let charged_fee = if remaining_fee_capacity <= 0 {
            0
        } else {
            incremental_fee.min(remaining_fee_capacity)
        };

        if charged_fee > 0 {
            loan.accrued_late_fee = loan
                .accrued_late_fee
                .checked_add(charged_fee)
                .expect("late fee overflow");
        }
        loan.last_late_fee_ledger = current_ledger;
        charged_fee
    }

    fn current_total_debt(env: &Env, loan: &mut Loan) -> (i128, i128) {
        Self::accrue_interest(env, loan);
        let late_fee_delta = Self::accrue_late_fee(env, loan);
        let total_debt = Self::remaining_principal(loan)
            .checked_add(loan.accrued_interest)
            .and_then(|value| value.checked_add(loan.accrued_late_fee))
            .expect("debt overflow");
        (total_debt, late_fee_delta)
    }

    pub fn initialize(
        env: Env,
        nft_contract: Address,
        lending_pool: Address,
        token: Address,
        admin: Address,

        treasury_address: Address,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage()
            .instance()
            .set(&DataKey::NftContract, &nft_contract);
        env.storage()
            .instance()
            .set(&DataKey::LendingPool, &lending_pool);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::LoanCounter, &0u32);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage()
            .instance()
            .set(&DataKey::LateFeeRateBps, &Self::DEFAULT_LATE_FEE_RATE_BPS);

        env.storage().instance().set(
            &DataKey::ProtocolFeeRateBps,
            &Self::DEFAULT_PROTOCOL_FEE_RATE_BPS,
        );
        env.storage()
            .instance()
            .set(&DataKey::TreasuryAddress, &treasury_address);

        Self::bump_instance_ttl(&env);
    }

    pub fn request_loan(env: Env, borrower: Address, amount: i128) -> u32 {
        borrower.require_auth();
        Self::assert_not_paused(&env);

        if amount <= 0 {
            panic!("loan amount must be positive");
        }

        let nft_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::NftContract)
            .expect("not initialized");
        let nft_client = NftClient::new(&env, &nft_contract);

        let score = nft_client.get_score(&borrower);
        let min_score: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinScore)
            .unwrap_or(500);
        if score < min_score {
            panic!("score too low for loan");
        }

        // Create loan record
        let mut loan_counter: u32 = env
            .storage()
            .instance()
            .get(&DataKey::LoanCounter)
            .unwrap_or(0);
        loan_counter += 1;

        let loan = Loan {
            borrower: borrower.clone(),
            amount,
            principal_paid: 0,
            interest_paid: 0,
            accrued_interest: 0,
            late_fee_paid: 0,
            accrued_late_fee: 0,
            interest_rate_bps: Self::DEFAULT_INTEREST_RATE_BPS,
            due_date: 0,
            last_interest_ledger: 0,
            last_late_fee_ledger: 0,
            status: LoanStatus::Pending,
            extension_count: 0,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Loan(loan_counter), &loan);
        env.storage()
            .instance()
            .set(&DataKey::LoanCounter, &loan_counter);
        Self::bump_instance_ttl(&env);
        Self::bump_persistent_ttl(&env, &DataKey::Loan(loan_counter));

        events::loan_requested(&env, borrower.clone(), amount);
        env.events()
            .publish((symbol_short!("LoanReq"), borrower), loan_counter);

        loan_counter
    }

    pub fn approve_loan(env: Env, loan_id: u32) {
        use soroban_sdk::token::TokenClient;

        // Access control: only admin can approve loans
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
        Self::assert_not_paused(&env);

        // Get loan record
        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .expect("loan not found");
        Self::bump_persistent_ttl(&env, &loan_key);

        // Check loan status
        if loan.status != LoanStatus::Pending {
            panic!("loan is not pending");
        }

        // Determine term length from admin-configured default (falls back to compile-time constant)
        let term_ledgers: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinTermLedgers)
            .unwrap_or(Self::DEFAULT_TERM_LEDGERS);

        // Update loan status to Approved
        loan.status = LoanStatus::Approved;
        loan.due_date = env.ledger().sequence() + term_ledgers;
        loan.last_interest_ledger = env.ledger().sequence();
        loan.last_late_fee_ledger = loan.due_date;
        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(&env, &loan_key);

        // Transfer funds from LendingPool to borrower
        let lending_pool: Address = env
            .storage()
            .instance()
            .get(&DataKey::LendingPool)
            .expect("lending pool not set");
        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("token not set");
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&lending_pool, &loan.borrower, &loan.amount);

        events::loan_approved(&env, loan_id);
        env.events()
            .publish((symbol_short!("LoanAppr"), loan.borrower.clone()), loan_id);
    }

    pub fn get_loan(env: Env, loan_id: u32) -> Loan {
        let loan_key = DataKey::Loan(loan_id);
        let mut loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .expect("loan not found");
        Self::bump_persistent_ttl(&env, &loan_key);
        let _ = Self::current_total_debt(&env, &mut loan);
        loan
    }

    pub fn repay(env: Env, borrower: Address, loan_id: u32, amount: i128) {
        use soroban_sdk::token::TokenClient;

        borrower.require_auth();
        Self::assert_not_paused(&env);

        if amount <= 0 {
            panic!("repayment amount must be positive");
        }

        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .expect("loan not found");

        if loan.borrower != borrower {
            panic!("borrower does not own loan");
        }
        if loan.status != LoanStatus::Approved {
            panic!("loan is not active");
        }

        let (total_debt, late_fee_delta) = Self::current_total_debt(&env, &mut loan);

        let protocol_fee_rate = Self::protocol_fee_rate_bps(&env);
        let protocol_fee = amount
            .checked_mul(protocol_fee_rate as i128)
            .and_then(|value| value.checked_div(10_000))
            .expect("protocol fee calculation overflow");

        // The actual amount going to the lending pool, after fee deduction
        let amount_to_pool = amount
            .checked_sub(protocol_fee)
            .expect("repayment underflow after fee deduction");

        // Panic if the amount to pool is negative or repayment too low after fees
        if amount_to_pool <= 0 && amount > 0 {
            panic!("repayment too low to cover protocol fee or negative amount to pool");
        }

        // The check below should use the amount going to the pool, not the total amount
        if amount_to_pool > total_debt {
            // Compare amount_to_pool against total_debt
            panic!("repayment exceeds current total debt after fee deduction");
        }

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("token not set");
        let lending_pool: Address = env
            .storage()
            .instance()
            .get(&DataKey::LendingPool)
            .expect("lending pool not set");
        let token_client = TokenClient::new(&env, &token);

        if protocol_fee > 0 {
            let treasury_address = Self::treasury_address(&env);
            token_client.transfer(&borrower, &treasury_address, &protocol_fee);
            events::fee_collected(&env, loan_id, protocol_fee, treasury_address);
        }

        token_client.transfer(&borrower, &lending_pool, &amount);

        let interest_payment = amount.min(loan.accrued_interest);
        let after_interest_payment = amount
            .checked_sub(interest_payment)
            .expect("repayment underflow");
        let late_fee_payment = after_interest_payment.min(loan.accrued_late_fee);
        let principal_payment = after_interest_payment
            .checked_sub(late_fee_payment)
            .expect("repayment underflow");

        loan.interest_paid = loan
            .interest_paid
            .checked_add(interest_payment)
            .expect("interest paid overflow");
        loan.accrued_interest = loan
            .accrued_interest
            .checked_sub(interest_payment)
            .expect("interest underflow");
        loan.late_fee_paid = loan
            .late_fee_paid
            .checked_add(late_fee_payment)
            .expect("late fee paid overflow");
        loan.accrued_late_fee = loan
            .accrued_late_fee
            .checked_sub(late_fee_payment)
            .expect("late fee underflow");
        loan.principal_paid = loan
            .principal_paid
            .checked_add(principal_payment)
            .expect("principal paid overflow");

        if loan.principal_paid == loan.amount
            && loan.accrued_interest == 0
            && loan.accrued_late_fee == 0
        {
            loan.status = LoanStatus::Repaid;
        }

        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(&env, &loan_key);

        // Skip cross-contract call when repayment rounds to zero score points.
        if amount >= 100 {
            let nft_contract = Self::nft_contract(&env);
            let nft_client = NftClient::new(&env, &nft_contract);
            nft_client.update_score(&borrower, &amount, &None);
        }

        if late_fee_delta > 0 {
            events::late_fee_charged(&env, loan_id, late_fee_delta);
        }
        events::loan_repaid(&env, borrower, loan_id, amount);
    }

    pub fn set_late_fee_rate(env: Env, rate_bps: u32) {
        if rate_bps > 10_000 {
            panic!("late fee rate exceeds 100%");
        }

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::LateFeeRateBps, &rate_bps);
        Self::bump_instance_ttl(&env);
    }

    pub fn get_late_fee_rate(env: Env) -> u32 {
        Self::late_fee_rate_bps(&env)
    }

    pub fn set_protocol_fee_rate(env: Env, rate_bps: u32) {
        if rate_bps > 10_000 {
            panic!("protocol fee rate exceeds 100%");
        }

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::ProtocolFeeRateBps, &rate_bps);
        Self::bump_instance_ttl(&env);
    }

    pub fn get_protocol_fee_rate(env: Env) -> u32 {
        Self::protocol_fee_rate_bps(&env)
    }

    pub fn get_treasury_address(env: Env) -> Address {
        Self::treasury_address(&env)
    }

    pub fn set_min_score(env: Env, min_score: u32) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        let old_score: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinScore)
            .unwrap_or(500);
        env.storage().instance().set(&DataKey::MinScore, &min_score);
        Self::bump_instance_ttl(&env);
        events::min_score_updated(&env, old_score, min_score);
    }

    pub fn get_min_score(env: Env) -> u32 {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::MinScore)
            .unwrap_or(500)
    }

    /// Set the minimum term length (in ledgers) for new loans. Admin only.
    pub fn set_min_term_ledgers(env: Env, min_term: u32) {
        if min_term == 0 {
            panic!("min term must be greater than zero");
        }
        let max_term: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxTermLedgers)
            .unwrap_or(u32::MAX);
        if min_term > max_term {
            panic!("min term cannot exceed max term");
        }
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::MinTermLedgers, &min_term);
        Self::bump_instance_ttl(&env);
        events::term_limits_updated(&env, min_term, max_term);
    }

    /// Get the minimum term length (in ledgers). Defaults to DEFAULT_TERM_LEDGERS.
    pub fn get_min_term_ledgers(env: Env) -> u32 {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::MinTermLedgers)
            .unwrap_or(Self::DEFAULT_TERM_LEDGERS)
    }

    /// Set the maximum term length (in ledgers) for new loans. Admin only.
    pub fn set_max_term_ledgers(env: Env, max_term: u32) {
        if max_term == 0 {
            panic!("max term must be greater than zero");
        }
        let min_term: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinTermLedgers)
            .unwrap_or(0);
        if max_term < min_term {
            panic!("max term cannot be less than min term");
        }
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::MaxTermLedgers, &max_term);
        Self::bump_instance_ttl(&env);
        events::term_limits_updated(&env, min_term, max_term);
    }

    /// Get the maximum term length (in ledgers). Defaults to DEFAULT_TERM_LEDGERS.
    pub fn get_max_term_ledgers(env: Env) -> u32 {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::MaxTermLedgers)
            .unwrap_or(Self::DEFAULT_TERM_LEDGERS)
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
        events::paused(&env);
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
        events::unpaused(&env);
    }

    pub fn check_default(env: Env, loan_id: u32) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
        Self::assert_not_paused(&env);

        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .expect("loan not found");
        Self::bump_persistent_ttl(&env, &loan_key);

        if loan.status != LoanStatus::Approved {
            panic!("loan is not active");
        }

        let current_ledger = env.ledger().sequence();
        if current_ledger <= loan.due_date {
            panic!("loan is not past due");
        }

        loan.status = LoanStatus::Defaulted;
        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(&env, &loan_key);

        let nft_contract = Self::nft_contract(&env);
        let nft_client = NftClient::new(&env, &nft_contract);
        nft_client.record_default(&loan.borrower, &None);

        events::loan_defaulted(&env, loan_id, loan.borrower.clone());
    }

    pub fn check_defaults(env: Env, loan_ids: Vec<u32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
        Self::assert_not_paused(&env);

        for loan_id in loan_ids.iter() {
            let loan_key = DataKey::Loan(loan_id);
            let mut loan: Loan = match env.storage().persistent().get(&loan_key) {
                Some(l) => l,
                None => continue,
            };
            Self::bump_persistent_ttl(&env, &loan_key);

            if loan.status != LoanStatus::Approved {
                continue;
            }

            let current_ledger = env.ledger().sequence();
            if current_ledger <= loan.due_date {
                continue;
            }

            loan.status = LoanStatus::Defaulted;
            env.storage().persistent().set(&loan_key, &loan);
            Self::bump_persistent_ttl(&env, &loan_key);

            let nft_contract = Self::nft_contract(&env);
            let nft_client = NftClient::new(&env, &nft_contract);
            nft_client.record_default(&loan.borrower, &None);

            events::loan_defaulted(&env, loan_id, loan.borrower.clone());
        }
    }
}

#[cfg(test)]
mod test;
