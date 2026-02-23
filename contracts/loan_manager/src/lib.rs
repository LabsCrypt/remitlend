#![no_std]
use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, symbol_short, Address, Env,
};

#[contractclient(name = "NftClient")]
pub trait RemittanceNftInterface {
    fn get_score(env: Env, user: Address) -> u32;
    fn update_score(env: Env, user: Address, repayment_amount: i128, minter: Option<Address>);
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
    pub status: LoanStatus,
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
}

#[contract]
pub struct LoanManager;

#[contractimpl]
impl LoanManager {
    fn nft_contract(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::NftContract)
            .expect("not initialized")
    }

    pub fn initialize(
        env: Env,
        nft_contract: Address,
        lending_pool: Address,
        token: Address,
        admin: Address,
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
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).expect("not initialized");
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    pub fn request_loan(env: Env, borrower: Address, amount: i128) -> u32 {
        borrower.require_auth();

        if amount <= 0 {
            panic!("loan amount must be positive");
        }

        let nft_contract = Self::nft_contract(&env);
        let nft_client = NftClient::new(&env, &nft_contract);
        let score = nft_client.get_score(&borrower);
        if score < 500 {
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
            status: LoanStatus::Pending,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Loan(loan_counter), &loan);
        env.storage()
            .instance()
            .set(&DataKey::LoanCounter, &loan_counter);

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

        // Get loan record
        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .expect("loan not found");

        // Check loan status
        if loan.status != LoanStatus::Pending {
            panic!("loan is not pending");
        }

        // Update loan status to Approved
        loan.status = LoanStatus::Approved;
        env.storage().persistent().set(&loan_key, &loan);

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
        env.storage()
            .persistent()
            .get(&DataKey::Loan(loan_id))
            .expect("loan not found")
    }

    pub fn repay(env: Env, borrower: Address, amount: i128) {
        borrower.require_auth();
        if amount <= 0 {
            panic!("repayment amount must be positive");
        }

        // Repayment logic (placeholder)

        // Skip cross-contract call when repayment rounds to zero score points.
        if amount >= 100 {
            let nft_contract = Self::nft_contract(&env);
            let nft_client = NftClient::new(&env, &nft_contract);
            nft_client.update_score(&borrower, &amount, &None);
        }

        events::loan_repaid(&env, borrower, amount);
    }
}
