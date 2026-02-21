#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

mod nft {
    soroban_sdk::contractimport!(
        file = "../target/wasm32-unknown-unknown/release/remittance_nft.wasm"
    );
}

mod events;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LoanStatus {
    Pending,
    Approved,
    Repaid,
    Defaulted,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoanRequest {
    pub borrower: Address,
    pub amount: i128,
    pub term: u64,
    pub status: LoanStatus,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    NftContract,
    Loan(Address),
}

#[contract]
pub struct LoanManager;

#[contractimpl]
impl LoanManager {
    pub fn initialize(env: Env, nft_contract: Address) {
        if env.storage().instance().has(&DataKey::NftContract) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::NftContract, &nft_contract);
    }

    pub fn request_loan(env: Env, borrower: Address, amount: i128, term: u64) {
        borrower.require_auth();

        if amount <= 0 || term <= 0 {
            panic!("invalid loan parameters");
        }

        if env.storage().persistent().has(&DataKey::Loan(borrower.clone())) {
            panic!("active loan request already exists");
        }

        let nft_contract: Address = env.storage().instance().get(&DataKey::NftContract).expect("not initialized");
        let nft_client = nft::Client::new(&env, &nft_contract);
        
        // Reputation score must be at least 500
        let score = nft_client.get_score(&borrower);
        if score < 500 {
            panic!("insufficient reputation score");
        }
        let loan_request = LoanRequest {
            borrower: borrower.clone(),
            amount,
            term,
            status: LoanStatus::Pending,
        };

        env.storage().persistent().set(&DataKey::Loan(borrower.clone()), &loan_request);
        
        events::loan_requested(&env, borrower, amount);
    }

    pub fn get_loan(env: Env, borrower: Address) -> Option<LoanRequest> {
        env.storage().persistent().get(&DataKey::Loan(borrower))
    }

    pub fn approve_loan(env: Env, loan_id: u32) {
        // Approval logic
        
        events::loan_approved(&env, loan_id);
    }

    pub fn repay(env: Env, borrower: Address, amount: i128) {
        borrower.require_auth();
        
        // Repayment logic (placeholder)
        
        // Update score
        let nft_contract: Address = env.storage().instance().get(&DataKey::NftContract).expect("not initialized");
        let nft_client = nft::Client::new(&env, &nft_contract);
        nft_client.update_score(&borrower, &amount, &None);
        
        events::loan_repaid(&env, borrower, amount);
    }
}

#[cfg(test)]
mod test;
