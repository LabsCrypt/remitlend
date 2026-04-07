#![no_std]
use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, symbol_short, Address,
    BytesN, Env, String, Symbol, Vec,
};

const SCALE: i128 = 1_000_000;

#[contractclient(name = "NftClient")]
pub trait RemittanceNftInterface {
    fn get_score(env: Env, user: Address) -> u32;
    fn update_score(env: Env, user: Address, repayment_amount: i128, minter: Option<Address>);
    fn apply_score_delta(env: Env, user: Address, delta: i32, minter: Option<Address>);
    fn decrease_score(env: Env, user: Address, penalty_points: u32, minter: Option<Address>);
    fn seize_collateral(env: Env, user: Address, minter: Option<Address>);
    fn is_seized(env: Env, user: Address) -> bool;
    fn record_default(env: Env, user: Address, minter: Option<Address>);
    fn is_authorized_minter(env: Env, minter: Address) -> bool;
    fn is_paused(env: Env) -> bool;
}

#[contractclient(name = "RateOracleClient")]
pub trait RateOracleInterface {
    fn get_rate(env: Env, borrower: Address, amount: i128, score: u32) -> u32;
}

#[contractclient(name = "PoolClient")]
pub trait LendingPoolInterface {
    fn is_paused(env: Env) -> bool;
    fn pool_balance(env: Env, token: Address) -> i128;
}

mod events;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum LoanError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    LoanNotFound = 3,
    InsufficientScore = 4,
    LoanNotPending = 5,
    LoanNotActive = 6,
    InvalidAmount = 7,
    MaxLoansReached = 8,
    ContractPaused = 9,
    InsufficientPoolLiquidity = 10,
    LoanNotRepaid = 11,
    LoanNotPastDue = 12,
    RepaymentExceedsDebt = 13,
    BorrowerMismatch = 14,
    InvalidRate = 15,
    InvalidTerm = 16,
    LoanPastDue = 17,
    NoProposedAdmin = 18,
    PoolPaused = 19,
    NftPaused = 20,
    InvalidConfiguration = 21,
}

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum LoanStatus {
    Pending,
    Approved,
    Repaid,
    Defaulted,
    Cancelled,
    Rejected,
}

#[contracttype]
#[derive(Clone)]
pub struct Loan {
    pub borrower: Address,
    pub amount: i128,
    pub collateral_amount: i128,
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
    pub interest_residual: i128,
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
    MinRepaymentAmount,
    MaxLoanAmount,
    MaxLoansPerBorrower,
    BorrowerLoanCount(Address),
    BorrowerLoans(Address),
    Paused,
    InterestRateBps,
    DefaultTermLedgers,
    Version,
    LateFeeRateBps,
    MinTermLedgers,
    MaxTermLedgers,
    Collateral(u32),
    GracePeriodLedgers,
    DefaultWindowLedgers,
    RateOracle,
    ProposedAdmin,
    InterestResidual(u64),
    Residual(u64),
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
    const CURRENT_VERSION: u32 = 3;
    const DEFAULT_LATE_FEE_RATE_BPS: u32 = 500;
    const MAX_LATE_FEE_CAP_BPS: u32 = 2500;
    const DEFAULT_MAX_LOAN_AMOUNT: i128 = 50_000;
    const DEFAULT_MAX_LOANS_PER_BORROWER: u32 = 3;
    const DEFAULT_GRACE_PERIOD_LEDGERS: u32 = 4_320;
    const DEFAULT_DEFAULT_WINDOW_LEDGERS: u32 = Self::DEFAULT_TERM_LEDGERS;
    const LATE_REPAYMENT_SCORE_PENALTY: i32 = 10;
    const DEFAULT_SCORE_PENALTY_POINTS: u32 = 50;
    const DEFAULT_MIN_REPAYMENT_AMOUNT: i128 = 100;

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

    fn get_interest_residual(env: &Env, loan_id: u64) -> i128 {
    let residual_key = (symbol_short!("residual"), loan_id);

    env.storage()
        .instance()
        .get(&residual_key)
        .unwrap_or(0i128)
}

    fn set_interest_residual(env: &Env, loan_id: u64, value: i128) {
        let residual_key = (symbol_short!("residual"), loan_id);
        env.storage().instance().set(&residual_key, &value);
    }

    fn nft_contract(env: &Env) -> Address {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::NftContract)
            .expect("not initialized")
    }

    fn admin(env: &Env) -> Address {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    fn lending_pool(env: &Env) -> Address {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::LendingPool)
            .expect("not initialized")
    }

    fn loan_counter(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::LoanCounter)
            .unwrap_or(0)
    }

    fn read_interest_rate(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        let configured_rate = env
            .storage()
            .instance()
            .get(&DataKey::InterestRateBps)
            .unwrap_or(Self::DEFAULT_INTEREST_RATE_BPS);

        if configured_rate == 0 {
            Self::DEFAULT_INTEREST_RATE_BPS
        } else {
            configured_rate
        }
    }

    fn compute_interest_rate(env: &Env, borrower: &Address, amount: i128, score: u32) -> u32 {
        if let Some(oracle_addr) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::RateOracle)
        {
            let client = RateOracleClient::new(env, &oracle_addr);
            client.get_rate(borrower, &amount, &score)
        } else {
            Self::read_interest_rate(env)
        }
    }

    fn read_default_term(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::DefaultTermLedgers)
            .unwrap_or(Self::DEFAULT_TERM_LEDGERS)
    }

    fn require_not_paused(env: &Env) -> Result<(), LoanError> {
        Self::bump_instance_ttl(env);
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            return Err(LoanError::ContractPaused);
        }
        // Cascade: also check whether the LendingPool is paused.
        if let Some(pool_addr) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::LendingPool)
        {
            let pool_client = PoolClient::new(env, &pool_addr);
            if pool_client.is_paused() {
                return Err(LoanError::PoolPaused);
            }
        }
        // Cascade: also check whether the RemittanceNFT is paused.
        if let Some(nft_addr) = env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::NftContract)
        {
            let nft_client = NftClient::new(env, &nft_addr);
            if nft_client.is_paused() {
                return Err(LoanError::NftPaused);
            }
        }
        Ok(())
    }

    fn remaining_principal(loan: &Loan) -> i128 {
        loan.amount
            .checked_sub(loan.principal_paid)
            .expect("principal paid exceeds amount")
    }

    fn accrue_interest(env: &Env, loan_id: u64, loan: &mut Loan) {
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
        const PRECISION: i128 = 1_000_000;

        // Calculate interest with high precision to avoid truncation for small loans
        let numerator = remaining_principal
            .checked_mul(loan.interest_rate_bps as i128)
            .and_then(|v| v.checked_mul(elapsed_ledgers as i128))
            .and_then(|v| v.checked_mul(PRECISION))
            .expect("interest calculation overflow");

        let denominator = 10_000i128
            .checked_mul(Self::DEFAULT_TERM_LEDGERS as i128)
            .expect("denominator overflow");

        let total_interest = numerator / denominator;
        let interest_delta = total_interest / PRECISION;
        let new_residual = total_interest % PRECISION;

        // Add the previous residual to the new calculation
        let residual = Self::get_interest_residual(env, loan_id);

        let new_interest = 0; // calculated
        let total = residual + new_interest;

        let whole = total / SCALE;
        let remainder = total % SCALE;

        loan.accrued_interest += whole;
        Self::set_interest_residual(env, loan_id, remainder);

        // load previous residual
        let residual_key = (symbol_short!("residual"), loan_id);
        let prev_residual: i128 = env.storage().instance().get(&residual_key).unwrap_or(0i128);

        // combine
        let combined_residual = prev_residual + new_residual;

        // split
        let additional_interest = combined_residual / PRECISION;
        let final_residual = combined_residual % PRECISION;

        // apply interest
        loan.accrued_interest = loan
            .accrued_interest
            .checked_add(interest_delta)
            .and_then(|v| v.checked_add(additional_interest))
            .expect("interest overflow");

        // store residual
        let residual_key = DataKey::Residual(loan_id);

        env.storage().instance().set(&residual_key, &final_residual);
    }

    #[allow(dead_code)]
    fn late_fee_rate_bps(env: &Env) -> u32 {
        // Bump the instance TTL (side effect only)
        Self::bump_instance_ttl(env);

        // Get the stored late fee rate or use the default
        env
    .storage()
    .instance()
    .get(&DataKey::LateFeeRateBps)
    .unwrap_or(Self::DEFAULT_LATE_FEE_RATE_BPS) // return explicitly
    }

    fn grace_period_ledgers(env: &Env) -> u32 {
        // Update the instance TTL as needed
        Self::bump_instance_ttl(env);

        // Retrieve the value from storage, or use default if missing
        env.storage()
            .instance()
            .get::<_, u32>(&DataKey::GracePeriodLedgers)
            .unwrap_or(Self::DEFAULT_GRACE_PERIOD_LEDGERS)
    }
    fn default_window_ledgers(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::DefaultWindowLedgers)
            .unwrap_or(Self::DEFAULT_DEFAULT_WINDOW_LEDGERS)
    }

    fn max_loan_amount(env: &Env) -> i128 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::MaxLoanAmount)
            .unwrap_or(Self::DEFAULT_MAX_LOAN_AMOUNT)
    }

    fn max_loans_per_borrower(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::MaxLoansPerBorrower)
            .unwrap_or(Self::DEFAULT_MAX_LOANS_PER_BORROWER)
    }

    fn min_repayment_amount(env: &Env) -> i128 {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::MinRepaymentAmount)
            .unwrap_or(Self::DEFAULT_MIN_REPAYMENT_AMOUNT)
    }

    fn borrower_loan_count(env: &Env, borrower: &Address) -> u32 {
        let key = DataKey::BorrowerLoanCount(borrower.clone());
        if env.storage().persistent().has(&key) {
            let count = env.storage().persistent().get(&key).unwrap_or(0u32);
            Self::bump_persistent_ttl(env, &key);
            count
        } else {
            0
        }
    }

    fn increment_borrower_loan_count(env: &Env, borrower: &Address) {
        let key = DataKey::BorrowerLoanCount(borrower.clone());
        let current_count = Self::borrower_loan_count(env, borrower);
        let next_count = current_count
            .checked_add(1)
            .expect("borrower loan count overflow");
        env.storage().persistent().set(&key, &next_count);
        Self::bump_persistent_ttl(env, &key);
    }

    fn decrement_borrower_loan_count(env: &Env, borrower: &Address) {
        let key = DataKey::BorrowerLoanCount(borrower.clone());
        let current_count = Self::borrower_loan_count(env, borrower);
        if current_count == 0 {
            return;
        }
        let next_count = current_count - 1;
        env.storage().persistent().set(&key, &next_count);
        Self::bump_persistent_ttl(env, &key);
    }

    fn accrue_late_fee(env: &Env, loan: &mut Loan) -> i128 {
        if loan.status != LoanStatus::Approved {
            return 0;
        }

        let current_ledger = env.ledger().sequence();
        if loan.due_date == 0 {
            return 0;
        }

        let grace_ends = loan
            .due_date
            .checked_add(Self::grace_period_ledgers(env))
            .expect("grace period overflow");
        if current_ledger <= grace_ends {
            return 0;
        }

        let late_fee_start = loan.last_late_fee_ledger.max(grace_ends);
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

   fn current_total_debt(env: &Env, loan_id: u64, loan: &mut Loan) -> (i128, i128) {
    Self::accrue_interest(env, loan_id, loan);
    let late_fee_delta = Self::accrue_late_fee(env, loan);

    let total_debt = Self::remaining_principal(loan)
        .checked_add(loan.accrued_interest)
        .and_then(|value| value.checked_add(loan.accrued_late_fee))
        .expect("debt overflow");

    (total_debt, late_fee_delta)
}
    /// Split a repayment across principal, interest, and late fees based on
    /// each component's share of the current total debt. This avoids a strict
    /// waterfall where a borrower can repeatedly clear one bucket first while
    /// delaying principal reduction.
    fn proportional_repayment_split(loan: &Loan, amount: i128) -> (i128, i128, i128) {
        let principal_due = Self::remaining_principal(loan);
        let total_debt = principal_due
            .checked_add(loan.accrued_interest)
            .and_then(|value| value.checked_add(loan.accrued_late_fee))
            .expect("debt overflow");

        if total_debt == 0 {
            return (0, 0, 0);
        }

        let dues = [principal_due, loan.accrued_interest, loan.accrued_late_fee];
        let mut payments = [0i128; 3];
        let mut remainders = [-1i128; 3];
        let mut allocated = 0i128;

        for idx in 0..3 {
            let due = dues[idx];
            if due <= 0 {
                continue;
            }

            let scaled = amount
                .checked_mul(due)
                .expect("repayment allocation overflow");
            let payment = scaled
                .checked_div(total_debt)
                .expect("repayment allocation underflow");

            payments[idx] = payment;
            remainders[idx] = scaled
                .checked_rem(total_debt)
                .expect("repayment allocation underflow");
            allocated = allocated
                .checked_add(payment)
                .expect("repayment allocation overflow");
        }

        let mut unallocated = amount
            .checked_sub(allocated)
            .expect("repayment allocation underflow");

        while unallocated > 0 {
            let mut selected: Option<usize> = None;

            for idx in 0..3 {
                if dues[idx] <= payments[idx] || remainders[idx] < 0 {
                    continue;
                }

                match selected {
                    None => selected = Some(idx),
                    Some(current) => {
                        if remainders[idx] > remainders[current] {
                            selected = Some(idx);
                        }
                    }
                }
            }

            let idx = selected.expect("repayment allocation exhausted");
            payments[idx] = payments[idx]
                .checked_add(1)
                .expect("repayment allocation overflow");
            remainders[idx] = -1;
            unallocated -= 1;
        }

        let principal_payment = payments[0];
        let interest_payment = payments[1];
        let late_fee_payment = payments[2];

        (principal_payment, interest_payment, late_fee_payment)
    }

    fn collateral_amount(env: &Env, loan_id: u32) -> i128 {
        let loan_key = DataKey::Loan(loan_id);
        if let Some(loan) = env.storage().persistent().get::<DataKey, Loan>(&loan_key) {
            Self::bump_persistent_ttl(env, &loan_key);
            loan.collateral_amount
        } else {
            0
        }
    }

    fn release_collateral_internal(env: &Env, loan_id: u32, recipient: &Address) {
        use soroban_sdk::token::TokenClient;

        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .unwrap_or_else(|| panic!("loan not found"));

        let collateral = loan.collateral_amount;
        if collateral <= 0 {
            return;
        }

        loan.collateral_amount = 0;
        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(env, &loan_key);

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("token not set");
        let token_client = TokenClient::new(env, &token);
        token_client.transfer(&env.current_contract_address(), recipient, &collateral);

        // Emit collateral returned event
        events::collateral_returned(env, recipient.clone(), loan_id, collateral);
    }

    fn seize_collateral_internal(env: &Env, loan_id: u32) {
        use soroban_sdk::token::TokenClient;

        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .unwrap_or_else(|| panic!("loan not found"));

        let collateral = loan.collateral_amount;
        if collateral <= 0 {
            return;
        }

        loan.collateral_amount = 0;
        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(env, &loan_key);

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
        let token_client = TokenClient::new(env, &token);
        token_client.transfer(&env.current_contract_address(), &lending_pool, &collateral);

        events::collateral_liquidated(env, loan_id, collateral);
    }

    pub fn initialize(
        env: Env,
        nft_contract: Address,
        lending_pool: Address,
        token: Address,
        admin: Address,
    ) -> Result<(), LoanError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(LoanError::AlreadyInitialized);
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

        let nft_client = NftClient::new(&env, &nft_contract);
        if !nft_client.is_authorized_minter(&env.current_contract_address()) {
            panic!("LoanManager must be authorized minter on NFT contract");
        }
        env.storage()
            .instance()
            .set(&DataKey::Version, &Self::CURRENT_VERSION);
        env.storage()
            .instance()
            .set(&DataKey::MaxLoanAmount, &Self::DEFAULT_MAX_LOAN_AMOUNT);
        env.storage().instance().set(
            &DataKey::MaxLoansPerBorrower,
            &Self::DEFAULT_MAX_LOANS_PER_BORROWER,
        );
        env.storage()
            .instance()
            .set(&DataKey::LateFeeRateBps, &Self::DEFAULT_LATE_FEE_RATE_BPS);
        env.storage().instance().set(
            &DataKey::GracePeriodLedgers,
            &Self::DEFAULT_GRACE_PERIOD_LEDGERS,
        );
        env.storage().instance().set(
            &DataKey::DefaultWindowLedgers,
            &Self::DEFAULT_DEFAULT_WINDOW_LEDGERS,
        );
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    pub fn version(env: Env) -> u32 {
        Self::bump_instance_ttl(&env);
        env.storage().instance().get(&DataKey::Version).unwrap_or(0)
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        Self::admin(&env).require_auth();
        let old_version = Self::version(env.clone());
        let new_version = old_version.saturating_add(1);
        env.storage()
            .instance()
            .set(&DataKey::Version, &new_version);
        env.events().publish(
            (Symbol::new(&env, "ContractUpgraded"),),
            (old_version, new_version),
        );
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    pub fn migrate(env: Env) {
        Self::admin(&env).require_auth();

        if !env.storage().instance().has(&DataKey::LateFeeRateBps) {
            env.storage()
                .instance()
                .set(&DataKey::LateFeeRateBps, &Self::DEFAULT_LATE_FEE_RATE_BPS);
        }
        env.storage()
            .instance()
            .set(&DataKey::Version, &Self::CURRENT_VERSION);
        Self::bump_instance_ttl(&env);
    }

    pub fn request_loan(env: Env, borrower: Address, amount: i128) -> Result<u32, LoanError> {
        borrower.require_auth();
        Self::require_not_paused(&env)?;

        if amount <= 0 {
            return Err(LoanError::InvalidAmount);
        }

        let max_loan_amount = Self::max_loan_amount(&env);
        if amount > max_loan_amount {
            return Err(LoanError::InvalidAmount);
        }

        let nft_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::NftContract)
            .ok_or(LoanError::NotInitialized)?;
        let nft_client = NftClient::new(&env, &nft_contract);

        let score = nft_client.get_score(&borrower);
        let min_score: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinScore)
            .unwrap_or(500);
        if score < min_score {
            return Err(LoanError::InsufficientScore);
        }

        let active_loan_count = Self::borrower_loan_count(&env, &borrower);
        let max_loans_per_borrower = Self::max_loans_per_borrower(&env);
        if active_loan_count >= max_loans_per_borrower {
            return Err(LoanError::MaxLoansReached);
        }

        let mut loan_counter: u32 = env
            .storage()
            .instance()
            .get(&DataKey::LoanCounter)
            .unwrap_or(0);
        loan_counter += 1;

        let loan = Loan {
            borrower: borrower.clone(),
            amount,
            collateral_amount: 0,
            principal_paid: 0,
            interest_paid: 0,
            accrued_interest: 0,
            late_fee_paid: 0,
            accrued_late_fee: 0,
            interest_rate_bps: Self::compute_interest_rate(&env, &borrower, amount, score),
            due_date: 0,
            last_interest_ledger: 0,
            last_late_fee_ledger: 0,
            status: LoanStatus::Pending,
            interest_residual: 0,
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

        // Add loan ID to borrower's loan list
        let borrower_loans_key = DataKey::BorrowerLoans(borrower.clone());
        let mut borrower_loans: Vec<u32> = env
            .storage()
            .instance()
            .get(&borrower_loans_key)
            .unwrap_or(Vec::new(&env));
        borrower_loans.push_back(loan_counter);
        env.storage()
            .instance()
            .set(&borrower_loans_key, &borrower_loans);
        Self::bump_instance_ttl(&env);

        events::loan_requested(&env, borrower.clone(), amount);
        env.events()
            .publish((symbol_short!("LoanReq"), borrower), loan_counter);

        Ok(loan_counter)
    }

    pub fn approve_loan(env: Env, loan_id: u32) -> Result<(), LoanError> {
        use soroban_sdk::token::TokenClient;

        let admin = Self::admin(&env);
        admin.require_auth();
        Self::require_not_paused(&env)?;

        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);

        if loan.status != LoanStatus::Pending {
            return Err(LoanError::LoanNotPending);
        }

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
        let pool_client = PoolClient::new(&env, &lending_pool);
        let pool_balance = pool_client.pool_balance(&token);
        if pool_balance < loan.amount {
            return Err(LoanError::InsufficientPoolLiquidity);
        }

        let term_ledgers = Self::read_default_term(&env);

        loan.status = LoanStatus::Approved;
        loan.due_date = env.ledger().sequence() + term_ledgers;
        loan.last_interest_ledger = env.ledger().sequence();
        loan.last_late_fee_ledger = loan
            .due_date
            .checked_add(Self::grace_period_ledgers(&env))
            .expect("grace period overflow");
        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(&env, &loan_key);
        let token_client = TokenClient::new(&env, &token);

        Self::increment_borrower_loan_count(&env, &loan.borrower);
        token_client.transfer(&lending_pool, &loan.borrower, &loan.amount);

        events::loan_approved(&env, loan_id, loan.borrower.clone());
        events::loan_approved_by_admin(&env, admin, loan_id, loan.borrower.clone());

        Ok(())
    }

    pub fn get_loan(env: Env, loan_id: u32) -> Result<Loan, LoanError> {
        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);
        let _ = Self::current_total_debt(&env, loan_id.into(), &mut loan);
        Ok(loan)
    }

    pub fn repay(env: Env, borrower: Address, loan_id: u32, amount: i128) -> Result<(), LoanError> {
        use soroban_sdk::token::TokenClient;

        borrower.require_auth();
        Self::require_not_paused(&env)?;

        if amount <= 0 {
            return Err(LoanError::InvalidAmount);
        }

        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);

        if loan.borrower != borrower {
            return Err(LoanError::BorrowerMismatch);
        }

        if loan.status != LoanStatus::Approved {
            return Err(LoanError::LoanNotActive);
        }

        // Allow repayment until end of default window
        let current_ledger = env.ledger().sequence();
        let default_ends = loan
            .due_date
            .checked_add(Self::default_window_ledgers(&env))
            .expect("default window overflow");
        if current_ledger > default_ends {
            return Err(LoanError::LoanPastDue);
        }

        let (total_debt, late_fee_delta) = Self::current_total_debt(&env, loan_id.into(), &mut loan);
        if amount > total_debt {
            return Err(LoanError::RepaymentExceedsDebt);
        }

        let min_repayment_amount = Self::min_repayment_amount(&env);

        // Allow below-minimum repayment only when it fully clears the remaining debt
        // or when the remaining debt itself is just small rounding dust.
        let is_rounding_dust_forgiveness = total_debt <= min_repayment_amount;

        if amount < total_debt && amount < min_repayment_amount && !is_rounding_dust_forgiveness {
            panic!("repayment amount below minimum");
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
        token_client.transfer(&borrower, &lending_pool, &amount);

        let (principal_payment, interest_payment, late_fee_payment) =
            Self::proportional_repayment_split(&loan, amount);

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

        let was_late = env.ledger().sequence()
            > loan
                .due_date
                .checked_add(Self::grace_period_ledgers(&env))
                .expect("grace period overflow");

        let mut completed = false;

        let is_fully_repaid = loan.principal_paid == loan.amount
            && loan.accrued_interest == 0
            && loan.accrued_late_fee == 0;

        if is_rounding_dust_forgiveness && !is_fully_repaid {
            loan.accrued_interest = 0;
            loan.accrued_late_fee = 0;

            if loan.principal_paid < loan.amount {
                loan.principal_paid = loan.amount;
            }

            completed = true;
        } else if is_fully_repaid {
            completed = true;
        }

        if completed {
            loan.status = LoanStatus::Repaid;
            loan.collateral_amount = 0;
            loan.interest_residual = 0;
            Self::decrement_borrower_loan_count(&env, &loan.borrower);
            Self::release_collateral_internal(&env, loan_id, &loan.borrower);
        }

        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(&env, &loan_key);

        if amount >= 100 {
            let nft_contract = Self::nft_contract(&env);
            let nft_client = NftClient::new(&env, &nft_contract);
            if completed && was_late {
                nft_client.decrease_score(
                    &borrower,
                    &Self::LATE_REPAYMENT_SCORE_PENALTY.unsigned_abs(),
                    &Some(env.current_contract_address()),
                );
            } else {
                nft_client.update_score(&borrower, &amount, &Some(env.current_contract_address()));
            }
        }

        if late_fee_delta > 0 {
            events::late_fee_charged(&env, loan_id, late_fee_delta);
        }
        events::loan_repaid(&env, borrower, loan_id, amount);

        Ok(())
    }

    pub fn deposit_collateral(env: Env, loan_id: u32, amount: i128) -> Result<(), LoanError> {
        use soroban_sdk::token::TokenClient;

        Self::require_not_paused(&env)?;

        if amount <= 0 {
            return Err(LoanError::InvalidAmount);
        }

        let loan_key = DataKey::Loan(loan_id);
        let loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);

        if loan.status != LoanStatus::Approved {
            return Err(LoanError::LoanNotActive);
        }

        loan.borrower.require_auth();

        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("token not set");
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&loan.borrower, &env.current_contract_address(), &amount);

        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .expect("loan not found");

        let updated_collateral = loan
            .collateral_amount
            .checked_add(amount)
            .expect("collateral overflow");
        loan.collateral_amount = updated_collateral;
        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(&env, &loan_key);

        env.events().publish(
            (symbol_short!("ColDep"), loan_id, loan.borrower),
            updated_collateral,
        );

        Ok(())
    }

    pub fn release_collateral(env: Env, loan_id: u32) -> Result<(), LoanError> {
        Self::require_not_paused(&env)?;

        let loan_key = DataKey::Loan(loan_id);
        let loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);

        if loan.status != LoanStatus::Repaid {
            return Err(LoanError::LoanNotRepaid);
        }

        Self::release_collateral_internal(&env, loan_id, &loan.borrower);
        env.events()
            .publish((symbol_short!("ColRel"), loan_id, loan.borrower), ());

        Ok(())
    }

    pub fn get_collateral(env: Env, loan_id: u32) -> i128 {
        Self::collateral_amount(&env, loan_id)
    }

    pub fn cancel_loan(env: Env, borrower: Address, loan_id: u32) -> Result<(), LoanError> {
        borrower.require_auth();
        Self::require_not_paused(&env)?;

        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);

        if loan.borrower != borrower {
            return Err(LoanError::BorrowerMismatch);
        }
        if loan.status != LoanStatus::Pending {
            return Err(LoanError::LoanNotPending);
        }

        // Return collateral if any was posted
        Self::release_collateral_internal(&env, loan_id, &borrower);

        loan.status = LoanStatus::Cancelled;
        loan.collateral_amount = 0;
        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(&env, &loan_key);
        events::loan_cancelled(&env, borrower, loan_id);

        Ok(())
    }

    pub fn reject_loan(env: Env, loan_id: u32, reason: String) -> Result<(), LoanError> {
        Self::admin(&env).require_auth();
        Self::require_not_paused(&env)?;

        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);

        if loan.status != LoanStatus::Pending {
            return Err(LoanError::LoanNotPending);
        }

        // Return collateral if any was posted
        Self::release_collateral_internal(&env, loan_id, &loan.borrower);

        loan.status = LoanStatus::Rejected;
        loan.collateral_amount = 0;
        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(&env, &loan_key);
        events::loan_rejected(&env, loan_id, reason);

        Ok(())
    }

    /// Refinance an active loan in good standing (not past due).
    /// Settles all accrued interest and late fees, adjusts the principal to
    /// new_amount (drawing from or returning funds to the pool), and resets
    /// the due date to current_ledger + new_term.
    /// Requires both borrower auth and admin auth.
    pub fn refinance_loan(
        env: Env,
        loan_id: u32,
        new_amount: i128,
        new_term: u32,
    ) -> Result<(), LoanError> {
        use soroban_sdk::token::TokenClient;

        Self::require_not_paused(&env)?;

        // Both borrower and admin must authorise.
        let admin = Self::admin(&env);
        admin.require_auth();

        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);

        // Borrower must also sign.
        loan.borrower.require_auth();

        if loan.status != LoanStatus::Approved {
            return Err(LoanError::LoanNotActive);
        }

        // Allow refinance until end of default window
        let current_ledger = env.ledger().sequence();
        let default_ends = loan
            .due_date
            .checked_add(Self::default_window_ledgers(&env))
            .expect("default window overflow");
        if current_ledger > default_ends {
            return Err(LoanError::LoanPastDue);
        }

        if new_amount <= 0 {
            return Err(LoanError::InvalidAmount);
        }
        if new_amount > Self::max_loan_amount(&env) {
            return Err(LoanError::InvalidAmount);
        }

        let min_term: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinTermLedgers)
            .unwrap_or(0);
        let max_term: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxTermLedgers)
            .unwrap_or(u32::MAX);
        if new_term < min_term || new_term > max_term {
            return Err(LoanError::InvalidTerm);
        }

        // Re-validate credit score (treat refinance like new loan application)
        let nft_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::NftContract)
            .ok_or(LoanError::NotInitialized)?;
        let nft_client = NftClient::new(&env, &nft_contract);

        let current_score = nft_client.get_score(&loan.borrower);
        let min_score: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinScore)
            .unwrap_or(500);
        if current_score < min_score {
            return Err(LoanError::InsufficientScore);
        }

        // Validate collateral covers new amount (collateral must be >= loan amount)
        if loan.collateral_amount < new_amount {
            return Err(LoanError::InsufficientScore);
        }

        // Settle all accrued interest and late fees up to now.
        Self::accrue_interest(&env, loan_id.into(), &mut loan);
        let _ = Self::accrue_late_fee(&env, &mut loan);

        loan.interest_paid = loan
            .interest_paid
            .checked_add(loan.accrued_interest)
            .expect("overflow");
        loan.accrued_interest = 0;

        loan.late_fee_paid = loan
            .late_fee_paid
            .checked_add(loan.accrued_late_fee)
            .expect("overflow");
        loan.accrued_late_fee = 0;
        loan.interest_residual = 0;

        // Adjust principal to new_amount.
        let remaining_principal = Self::remaining_principal(&loan);

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

        match new_amount.cmp(&remaining_principal) {
            core::cmp::Ordering::Greater => {
                // Pool disburses the additional amount to the borrower.
                let additional = new_amount
                    .checked_sub(remaining_principal)
                    .expect("underflow");
                let pool_balance = token_client.balance(&lending_pool);
                if pool_balance < additional {
                    return Err(LoanError::InsufficientPoolLiquidity);
                }
                token_client.transfer(&lending_pool, &loan.borrower, &additional);
            }
            core::cmp::Ordering::Less => {
                // Borrower returns the excess principal to the pool.
                let excess_principal = remaining_principal
                    .checked_sub(new_amount)
                    .expect("underflow");
                token_client.transfer(&loan.borrower, &lending_pool, &excess_principal);

                // Return excess collateral proportionally if new amount is smaller
                if new_amount < remaining_principal {
                    let collateral_to_return = loan
                        .collateral_amount
                        .checked_mul(excess_principal)
                        .expect("multiplication overflow")
                        .checked_div(remaining_principal)
                        .expect("division by zero");
                    if collateral_to_return > 0 {
                        token_client.transfer(
                            &env.current_contract_address(),
                            &loan.borrower,
                            &collateral_to_return,
                        );
                        loan.collateral_amount = loan
                            .collateral_amount
                            .checked_sub(collateral_to_return)
                            .expect("underflow");
                    }
                }
            }
            core::cmp::Ordering::Equal => {}
        }

        // Reset loan terms with new amount and rate.
        loan.amount = new_amount;
        loan.principal_paid = 0;
        loan.interest_rate_bps =
            Self::compute_interest_rate(&env, &loan.borrower, new_amount, current_score);
        loan.last_interest_ledger = current_ledger;
        loan.due_date = current_ledger + new_term;
        loan.last_late_fee_ledger = loan.due_date;

        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(&env, &loan_key);

        events::loan_refinanced(&env, loan_id, loan.borrower.clone(), new_amount, new_term);

        Ok(())
    }

    pub fn set_late_fee_rate(env: Env, rate_bps: u32) -> Result<(), LoanError> {
        if rate_bps > 10_000 {
            return Err(LoanError::InvalidRate);
        }
        let admin = Self::admin(&env);
        admin.require_auth();

        let old_rate = Self::late_fee_rate_bps(&env);
        env.storage()
            .instance()
            .set(&DataKey::LateFeeRateBps, &rate_bps);
        Self::bump_instance_ttl(&env);
        events::late_fee_rate_updated(&env, admin, old_rate, rate_bps);

        Ok(())
    }

    pub fn get_late_fee_rate(env: Env) -> u32 {
        Self::late_fee_rate_bps(&env)
    }

    pub fn set_grace_period_ledgers(env: Env, ledgers: u32) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        let old_ledgers = Self::grace_period_ledgers(&env);
        env.storage()
            .instance()
            .set(&DataKey::GracePeriodLedgers, &ledgers);
        Self::bump_instance_ttl(&env);
        events::grace_period_updated(&env, admin, old_ledgers, ledgers);
    }

    pub fn get_grace_period_ledgers(env: Env) -> u32 {
        Self::grace_period_ledgers(&env)
    }

    pub fn set_default_window_ledgers(env: Env, ledgers: u32) -> Result<(), LoanError> {
        const MIN_DEFAULT_WINDOW: u32 = 100;
        if ledgers < MIN_DEFAULT_WINDOW {
            return Err(LoanError::InvalidConfiguration);
        }

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(LoanError::NotInitialized)?;
        admin.require_auth();

        let old_ledgers = Self::default_window_ledgers(&env);
        env.storage()
            .instance()
            .set(&DataKey::DefaultWindowLedgers, &ledgers);
        Self::bump_instance_ttl(&env);
        events::default_window_updated(&env, admin, old_ledgers, ledgers);
        Ok(())
    }

    pub fn get_default_window_ledgers(env: Env) -> u32 {
        Self::default_window_ledgers(&env)
    }

    pub fn set_min_score(env: Env, min_score: u32) {
        Self::admin(&env).require_auth();

        let old_score: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinScore)
            .unwrap_or(500);
        env.storage().instance().set(&DataKey::MinScore, &min_score);
        Self::bump_instance_ttl(&env);
        events::min_score_updated(&env, old_score, min_score);
    }

    pub fn set_max_loan_amount(env: Env, amount: i128) -> Result<(), LoanError> {
        if amount <= 0 {
            return Err(LoanError::InvalidAmount);
        }

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(LoanError::NotInitialized)?;
        admin.require_auth();

        let old_amount = Self::max_loan_amount(&env);
        env.storage()
            .instance()
            .set(&DataKey::MaxLoanAmount, &amount);
        Self::bump_instance_ttl(&env);
        events::max_loan_amount_updated(&env, admin, old_amount, amount);

        Ok(())
    }

    pub fn get_max_loan_amount(env: Env) -> i128 {
        Self::max_loan_amount(&env)
    }

    pub fn set_min_repayment_amount(env: Env, amount: i128) {
        if amount < 0 {
            panic!("min repayment amount cannot be negative");
        }

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        let old_amount = Self::min_repayment_amount(&env);
        env.storage()
            .instance()
            .set(&DataKey::MinRepaymentAmount, &amount);
        Self::bump_instance_ttl(&env);
        events::min_repayment_updated(&env, admin, old_amount, amount);
    }

    pub fn get_min_repayment_amount(env: Env) -> i128 {
        Self::min_repayment_amount(&env)
    }

    pub fn set_max_loans_per_borrower(env: Env, max_loans: u32) -> Result<(), LoanError> {
        if max_loans == 0 {
            return Err(LoanError::InvalidAmount);
        }

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(LoanError::NotInitialized)?;
        admin.require_auth();

        let old_max = Self::max_loans_per_borrower(&env);
        env.storage()
            .instance()
            .set(&DataKey::MaxLoansPerBorrower, &max_loans);
        Self::bump_instance_ttl(&env);
        events::max_loans_per_borrower_updated(&env, admin, old_max, max_loans);

        Ok(())
    }

    pub fn get_max_loans_per_borrower(env: Env) -> u32 {
        Self::max_loans_per_borrower(&env)
    }

    pub fn get_borrower_loan_count(env: Env, borrower: Address) -> u32 {
        Self::borrower_loan_count(&env, &borrower)
    }

    pub fn get_admin(env: Env) -> Address {
        Self::admin(&env)
    }

    pub fn get_total_loans(env: Env) -> u32 {
        Self::loan_counter(&env)
    }

    pub fn get_lending_pool(env: Env) -> Address {
        Self::lending_pool(&env)
    }

    pub fn get_nft_contract(env: Env) -> Address {
        Self::nft_contract(&env)
    }

    pub fn get_borrower_loans(env: Env, borrower: Address) -> Vec<u32> {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::BorrowerLoans(borrower))
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_min_score(env: Env) -> u32 {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::MinScore)
            .unwrap_or(500)
    }

    pub fn set_interest_rate(env: Env, rate_bps: u32) -> Result<(), LoanError> {
        Self::admin(&env).require_auth();
        if rate_bps == 0 {
            return Err(LoanError::InvalidRate);
        }

        let old_rate = Self::read_interest_rate(&env);
        env.storage()
            .instance()
            .set(&DataKey::InterestRateBps, &rate_bps);
        Self::bump_instance_ttl(&env);
        events::interest_rate_updated(&env, old_rate, rate_bps);

        Ok(())
    }

    pub fn get_interest_rate(env: Env) -> u32 {
        Self::read_interest_rate(&env)
    }

    pub fn set_rate_oracle(env: Env, rate_oracle: Address) {
        Self::admin(&env).require_auth();

        let old_oracle = env.storage().instance().get(&DataKey::RateOracle);
        env.storage()
            .instance()
            .set(&DataKey::RateOracle, &rate_oracle);
        Self::bump_instance_ttl(&env);
        events::rate_oracle_updated(&env, old_oracle, rate_oracle);
    }

    pub fn get_rate_oracle(env: Env) -> Option<Address> {
        Self::bump_instance_ttl(&env);
        env.storage().instance().get(&DataKey::RateOracle)
    }

    pub fn set_default_term(env: Env, ledgers: u32) -> Result<(), LoanError> {
        Self::admin(&env).require_auth();
        if ledgers == 0 {
            return Err(LoanError::InvalidTerm);
        }

        let old_term = Self::read_default_term(&env);
        env.storage()
            .instance()
            .set(&DataKey::DefaultTermLedgers, &ledgers);
        Self::bump_instance_ttl(&env);
        events::default_term_updated(&env, old_term, ledgers);

        Ok(())
    }

    pub fn get_default_term(env: Env) -> u32 {
        Self::read_default_term(&env)
    }

    pub fn set_min_term_ledgers(env: Env, min_term: u32) -> Result<(), LoanError> {
        if min_term == 0 {
            return Err(LoanError::InvalidTerm);
        }
        let max_term: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MaxTermLedgers)
            .unwrap_or(u32::MAX);
        if min_term > max_term {
            return Err(LoanError::InvalidTerm);
        }
        Self::admin(&env).require_auth();
        env.storage()
            .instance()
            .set(&DataKey::MinTermLedgers, &min_term);
        Self::bump_instance_ttl(&env);
        events::term_limits_updated(&env, min_term, max_term);

        Ok(())
    }

    pub fn get_min_term_ledgers(env: Env) -> u32 {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::MinTermLedgers)
            .unwrap_or(Self::DEFAULT_TERM_LEDGERS)
    }

    pub fn set_max_term_ledgers(env: Env, max_term: u32) -> Result<(), LoanError> {
        if max_term == 0 {
            return Err(LoanError::InvalidTerm);
        }
        let min_term: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinTermLedgers)
            .unwrap_or(0);
        if max_term < min_term {
            return Err(LoanError::InvalidTerm);
        }
        Self::admin(&env).require_auth();
        env.storage()
            .instance()
            .set(&DataKey::MaxTermLedgers, &max_term);
        Self::bump_instance_ttl(&env);
        events::term_limits_updated(&env, min_term, max_term);

        Ok(())
    }

    pub fn get_max_term_ledgers(env: Env) -> u32 {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::MaxTermLedgers)
            .unwrap_or(Self::DEFAULT_TERM_LEDGERS)
    }

    pub fn propose_admin(env: Env, new_admin: Address) {
        let current_admin = Self::admin(&env);
        current_admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::ProposedAdmin, &new_admin);
        Self::bump_instance_ttl(&env);
        env.events().publish(
            (Symbol::new(&env, "AdminProposed"), current_admin),
            new_admin,
        );
    }

    pub fn accept_admin(env: Env) -> Result<(), LoanError> {
        let proposed_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::ProposedAdmin)
            .ok_or(LoanError::NotInitialized)?;
        proposed_admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::Admin, &proposed_admin);
        env.storage().instance().remove(&DataKey::ProposedAdmin);
        Self::bump_instance_ttl(&env);
        env.events()
            .publish((Symbol::new(&env, "AdminTransferred"),), proposed_admin);
        Ok(())
    }

    pub fn pause(env: Env) {
        Self::admin(&env).require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        Self::bump_instance_ttl(&env);
        events::paused(&env);
        env.events()
            .publish((Symbol::new(&env, "ContractPaused"),), ());
    }

    pub fn unpause(env: Env) {
        Self::admin(&env).require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        Self::bump_instance_ttl(&env);
        events::unpaused(&env);
        env.events()
            .publish((Symbol::new(&env, "ContractUnpaused"),), ());
    }

    pub fn is_paused(env: Env) -> bool {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    pub fn check_default(env: Env, loan_id: u32) -> Result<(), LoanError> {
        Self::admin(&env).require_auth();
        Self::require_not_paused(&env)?;

        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .ok_or(LoanError::LoanNotFound)?;
        Self::bump_persistent_ttl(&env, &loan_key);

        if loan.status != LoanStatus::Approved {
            return Err(LoanError::LoanNotActive);
        }

        let current_ledger = env.ledger().sequence();
        let default_eligible_after = loan
            .due_date
            .checked_add(Self::default_window_ledgers(&env))
            .expect("default window overflow");
        if current_ledger <= default_eligible_after {
            return Err(LoanError::LoanNotPastDue);
        }

        loan.status = LoanStatus::Defaulted;
        loan.accrued_interest = 0;
        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(&env, &loan_key);
        Self::decrement_borrower_loan_count(&env, &loan.borrower);
        Self::seize_collateral_internal(&env, loan_id);

        let nft_contract = Self::nft_contract(&env);
        let nft_client = NftClient::new(&env, &nft_contract);
        nft_client.decrease_score(
            &loan.borrower,
            &Self::DEFAULT_SCORE_PENALTY_POINTS,
            &Some(env.current_contract_address()),
        );
        nft_client.record_default(&loan.borrower, &Some(env.current_contract_address()));

        events::loan_defaulted(&env, loan_id, loan.borrower.clone());

        Ok(())
    }

    pub fn check_defaults(env: Env, loan_ids: Vec<u32>) -> Result<(), LoanError> {
        Self::admin(&env).require_auth();
        Self::require_not_paused(&env)?;

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
            let default_eligible_after = loan
                .due_date
                .checked_add(Self::default_window_ledgers(&env))
                .expect("default window overflow");
            if current_ledger <= default_eligible_after {
                continue;
            }

            loan.status = LoanStatus::Defaulted;
            loan.interest_residual = 0;
            env.storage().persistent().set(&loan_key, &loan);
            Self::bump_persistent_ttl(&env, &loan_key);
            Self::decrement_borrower_loan_count(&env, &loan.borrower);
            Self::seize_collateral_internal(&env, loan_id);

            let nft_contract = Self::nft_contract(&env);
            let nft_client = NftClient::new(&env, &nft_contract);
            nft_client.decrease_score(
                &loan.borrower,
                &Self::DEFAULT_SCORE_PENALTY_POINTS,
                &Some(env.current_contract_address()),
            );
            nft_client.record_default(&loan.borrower, &Some(env.current_contract_address()));

            events::loan_defaulted(&env, loan_id, loan.borrower.clone());
        }

        Ok(())
    }
}

#[cfg(test)]
mod test;
