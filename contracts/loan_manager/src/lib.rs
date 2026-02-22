#![no_std]
use soroban_sdk::{contract, contractclient, contractimpl, symbol_short, Address, Env};

#[contractclient(name = "NftClient")]
pub trait RemittanceNftInterface {
    fn get_score(env: Env, user: Address) -> u32;
    fn update_score(env: Env, user: Address, repayment_amount: i128, minter: Option<Address>);
}

mod events;

#[contract]
pub struct LoanManager;

#[contractimpl]
impl LoanManager {
    fn nft_key() -> soroban_sdk::Symbol {
        symbol_short!("NFT")
    }

    fn nft_contract(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&Self::nft_key())
            .expect("not initialized")
    }

    pub fn initialize(env: Env, nft_contract: Address) {
        let key = Self::nft_key();
        if env.storage().instance().has(&key) {
            panic!("already initialized");
        }
        env.storage().instance().set(&key, &nft_contract);
    }

    pub fn request_loan(env: Env, borrower: Address, amount: i128) {
        if amount <= 0 {
            panic!("loan amount must be positive");
        }

        let nft_contract = Self::nft_contract(&env);
        let nft_client = NftClient::new(&env, &nft_contract);
        
        let score = nft_client.get_score(&borrower);
        if score < 500 {
            panic!("score too low for loan");
        }
        // Loan request logic
        
        events::loan_requested(&env, borrower, amount);
    }

    pub fn approve_loan(env: Env, loan_id: u32) {
        // Approval logic
        
        events::loan_approved(&env, loan_id);
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

#[cfg(test)]
mod test;
