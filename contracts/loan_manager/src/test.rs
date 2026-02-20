#![cfg(test)]

use crate::{LoanManager, LoanManagerClient, nft};
use soroban_sdk::{testutils::{Address as _}, Address, Env, IntoVal};

fn setup_test<'a>(env: &Env) -> (LoanManagerClient<'a>, nft::Client<'a>, Address) {
    // 1. Deploy the NFT score mock contract
    let admin = Address::generate(env);
    let nft_contract_id = env.register(nft::WASM, ());
    let nft_client = nft::Client::new(env, &nft_contract_id);
    nft_client.initialize(&admin);

    // 2. Deploy the LoanManager contract
    let loan_manager_id = env.register(LoanManager, ());
    let loan_manager_client = LoanManagerClient::new(env, &loan_manager_id);
    
    // 3. Initialize the Loan Manager with the NFT contract mapping
    loan_manager_client.initialize(&nft_contract_id);

    (loan_manager_client, nft_client, admin)
}

#[test]
fn test_loan_request_success() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (manager, nft_client, admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Give borrower a score high enough to pass (>= 500)
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    // Should succeed without panicking
    manager.request_loan(&borrower, &1000);
}

#[test]
#[should_panic(expected = "score too low for loan")]
fn test_loan_request_failure_low_score() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (manager, nft_client, admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Give borrower a score too low to pass (< 500)
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &400, &history_hash, &None);

    // Should panic
    manager.request_loan(&borrower, &1000);
}

#[test]
fn test_approve_loan_flow() {
    let env = Env::default();
    
    let loan_manager_id = env.register(LoanManager, ());
    let manager = LoanManagerClient::new(&env, &loan_manager_id);
    
    // Currently approve_loan is a placeholder logic doing nothing
    // Verify it accepts requests cleanly.
    manager.approve_loan(&1);
}

#[test]
fn test_repayment_flow() {
    let env = Env::default();
    env.mock_all_auths();
    
    let (manager, nft_client, admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // 1. Borrower starts with a score of 600
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);
    assert_eq!(nft_client.get_score(&borrower), 600);

    // Disable strict top-level auth checks entirely for the internal execution
    env.mock_all_auths_allowing_non_root_auth();

    // 2. Repayment triggers update_score
    manager.repay(&borrower, &500);

    // 3. Verify the underlying NFT Score was correctly incremented
    assert_eq!(nft_client.get_score(&borrower), 605);
}

#[test]
#[should_panic]
fn test_access_controls_unauthorized_repay() {
    let env = Env::default();
    // NOT using mock_all_auths() to enforce actual signatures
    
    let (manager, nft_client, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);
    
    // Attempting to repay without proper Authorization scope should panic natively.
    manager.repay(&borrower, &500);
}
