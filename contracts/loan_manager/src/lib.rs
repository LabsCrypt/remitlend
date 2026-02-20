#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

mod nft {
    soroban_sdk::contractimport!(
        file = "../target/wasm32-unknown-unknown/release/remittance_nft.wasm"
    );
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    NftContract,
}

#[contract]
pub struct LoanManager;

#[contractimpl]
impl LoanManager {
    pub fn initialize(env: Env, nft_contract: Address) {
        env.storage().instance().set(&DataKey::NftContract, &nft_contract);
    }

    pub fn request_loan(env: Env, borrower: Address, amount: i128) {
        let nft_contract: Address = env.storage().instance().get(&DataKey::NftContract).expect("not initialized");
        let nft_client = nft::Client::new(&env, &nft_contract);
        
        let score = nft_client.get_score(&borrower);
        if score < 500 {
            panic!("score too low for loan");
        }
        // Loan request logic
    }

    pub fn approve_loan(_env: Env, _loan_id: u32) {
        // Approval logic
    }

    pub fn repay(env: Env, borrower: Address, amount: i128) {
        borrower.require_auth();
        
        // Repayment logic (placeholder)
        
        // Update score
        let nft_contract: Address = env.storage().instance().get(&DataKey::NftContract).expect("not initialized");
        let nft_client = nft::Client::new(&env, &nft_contract);
        nft_client.update_score(&borrower, &amount, &None);
    }
}

#[cfg(test)]
mod test;
