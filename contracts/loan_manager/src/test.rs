use crate::{LoanManager, LoanManagerClient, LoanStatus};
use remittance_nft::{RemittanceNFT, RemittanceNFTClient};
use soroban_sdk::testutils::Ledger as _;
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
use soroban_sdk::{testutils::Address as _, Address, Env};

fn setup_test<'a>(
    env: &Env,
) -> (
    LoanManagerClient<'a>,
    RemittanceNFTClient<'a>,
    Address,
    Address,
    Address,
    Address,
) {
    // 1. Deploy the NFT score contract
    let admin = Address::generate(env);
    let nft_contract_id = env.register(RemittanceNFT, ());
    let nft_client = RemittanceNFTClient::new(env, &nft_contract_id);
    nft_client.initialize(&admin);

    // 2. Deploy a test token
    let token_admin = Address::generate(env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_id = token_contract.address();

    // 3. Use a mock lending pool address (just an address, not a real contract for these tests)
    let pool_address = Address::generate(env);

    let treasury_address = Address::generate(env);

    // 4. Deploy the LoanManager contract
    let loan_manager_id = env.register(LoanManager, ());
    let loan_manager_client = LoanManagerClient::new(env, &loan_manager_id);

    // 5. Initialize the Loan Manager with the NFT contract, lending pool, token, and admin
    loan_manager_client.initialize(
        &nft_contract_id,
        &pool_address,
        &token_id,
        &admin,
        &treasury_address,
    );

    (
        loan_manager_client,
        nft_client,
        pool_address,
        token_id,
        token_admin,
        treasury_address,
    )
}

#[test]
fn test_loan_request_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, nft_client, _pool, _token, _token_admin, _treasury_address) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Give borrower a score high enough to pass (>= 500)
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    // Should succeed and return loan_id
    let loan_id = manager.request_loan(&borrower, &1000);
    assert_eq!(loan_id, 1);

    // Verify loan was created with Pending status
    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.borrower, borrower);
    assert_eq!(loan.amount, 1000);
    assert_eq!(loan.principal_paid, 0);
    assert_eq!(loan.interest_paid, 0);
    assert_eq!(loan.status, LoanStatus::Pending);
}

#[test]
#[should_panic(expected = "score too low for loan")]
fn test_loan_request_failure_low_score() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, nft_client, _pool, _token, _token_admin, _treasury_address) = setup_test(&env);
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
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_address, token_id, _token_admin, _treasury_address) =
        setup_test(&env);
    let borrower = Address::generate(&env);

    // 1. Give borrower a score high enough to pass
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    // 2. Setup liquidity - mint tokens to the pool address
    let token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_address, &10000);

    // 3. Request a loan
    let loan_id = manager.request_loan(&borrower, &1000);

    // 4. Verify loan is pending
    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Pending);

    // 5. Admin approves the loan
    manager.approve_loan(&loan_id);

    // 6. Verify loan status is now Approved
    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Approved);

    // 7. Verify borrower received the funds
    let borrower_balance = token_client.balance(&borrower);
    assert_eq!(borrower_balance, 1000);
}

#[test]
fn test_repayment_flow() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_address, token_id, _token_admin, _treasury_address) =
        setup_test(&env);
    let borrower = Address::generate(&env);

    // 1. Borrower starts with a score of 600
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);
    assert_eq!(nft_client.get_score(&borrower), 600);

    let token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_address, &10_000);
    stellar_token.mint(&borrower, &10_000);

    let loan_id = manager.request_loan(&borrower, &1000);
    manager.approve_loan(&loan_id);

    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 2_000);

    manager.repay(&borrower, &loan_id, &500);

    let loan = manager.get_loan(&loan_id);
    assert!(loan.principal_paid > 0);
    assert!(loan.interest_paid >= 0);
    assert_eq!(loan.status, LoanStatus::Approved);
    assert_eq!(token_client.balance(&pool_address), 9_500);

    // 3. Verify the underlying NFT Score was correctly incremented
    assert_eq!(nft_client.get_score(&borrower), 605);
}

#[test]
fn test_partial_repayment_tracks_split_balances() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_address, token_id, _token_admin, _treasury_address) =
        setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_address, &2_000_000);
    stellar_token.mint(&borrower, &2_000_000);

    let loan_id = manager.request_loan(&borrower, &1_000_000);
    manager.approve_loan(&loan_id);

    manager.repay(&borrower, &loan_id, &400_000);

    let after_partial = manager.get_loan(&loan_id);
    assert!(after_partial.principal_paid > 0);
    assert_eq!(
        after_partial.principal_paid + after_partial.interest_paid,
        400_000
    );
    assert_eq!(after_partial.status, LoanStatus::Approved);
}

#[test]
fn test_small_repayment_does_not_change_score() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_address, token_id, _token_admin, _treasury_address) =
        setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);
    assert_eq!(nft_client.get_score(&borrower), 600);

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_address, &10_000);
    stellar_token.mint(&borrower, &10_000);

    let loan_id = manager.request_loan(&borrower, &1000);
    manager.approve_loan(&loan_id);

    manager.repay(&borrower, &loan_id, &99);

    assert_eq!(nft_client.get_score(&borrower), 600);
}

#[test]
#[should_panic]
fn test_access_controls_unauthorized_repay() {
    let env = Env::default();
    // NOT using mock_all_auths() to enforce actual signatures

    let (manager, _nft_client, _pool, _token, _token_admin, _treasury_address) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Attempting to repay without proper Authorization scope should panic natively.
    manager.repay(&borrower, &1, &500);
}

#[test]
#[should_panic(expected = "loan not found")]
fn test_approve_nonexistent_loan() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, _nft, _pool, _token, _token_admin, _treasury_address) = setup_test(&env);

    // Try to approve a loan that doesn't exist
    manager.approve_loan(&999);
}

#[test]
#[should_panic(expected = "loan is not pending")]
fn test_approve_already_approved_loan() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_address, token_id, _token_admin, _treasury_address) =
        setup_test(&env);
    let borrower = Address::generate(&env);

    // Setup
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_address, &10000);

    // Request and approve loan
    let loan_id = manager.request_loan(&borrower, &1000);
    manager.approve_loan(&loan_id);

    // Try to approve again - should panic
    manager.approve_loan(&loan_id);
}

#[test]
#[should_panic(expected = "loan amount must be positive")]
fn test_request_loan_negative_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, nft_client, _pool, _token, _token_admin, _treasury_address) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    manager.request_loan(&borrower, &-1000);
}

#[test]
fn test_check_default_success() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_address, token_id, _token_admin, _treasury_address) =
        setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let stellar_token = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_address, &10_000);

    let loan_id = manager.request_loan(&borrower, &1000);
    manager.approve_loan(&loan_id);

    assert!(!nft_client.is_seized(&borrower));

    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 20_000);

    manager.check_default(&loan_id);

    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Defaulted);

    assert_eq!(nft_client.get_default_count(&borrower), 1);
    assert!(nft_client.is_seized(&borrower));
}

#[test]
#[should_panic(expected = "loan is not past due")]
fn test_check_default_not_past_due() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_address, token_id, _token_admin, _treasury_address) =
        setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let stellar_token = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_address, &10_000);

    let loan_id = manager.request_loan(&borrower, &1000);
    manager.approve_loan(&loan_id);

    manager.check_default(&loan_id);
}

#[test]
#[should_panic(expected = "loan is not active")]
fn test_check_default_already_repaid() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_address, token_id, _token_admin, _treasury_address) =
        setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let stellar_token = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_address, &10_000);
    stellar_token.mint(&borrower, &10_000);

    let loan_id = manager.request_loan(&borrower, &1000);
    manager.approve_loan(&loan_id);

    manager.repay(&borrower, &loan_id, &1000);

    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 20_000);

    manager.check_default(&loan_id);
}

#[test]
fn test_check_defaults_batch() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_address, token_id, _token_admin, _treasury_address) =
        setup_test(&env);
    let borrower1 = Address::generate(&env);
    let borrower2 = Address::generate(&env);
    let borrower3 = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower1, &600, &history_hash, &None);
    nft_client.mint(&borrower2, &600, &history_hash, &None);
    nft_client.mint(&borrower3, &600, &history_hash, &None);

    let stellar_token = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_address, &100_000);

    let loan_id1 = manager.request_loan(&borrower1, &1000);
    let loan_id2 = manager.request_loan(&borrower2, &1000);
    let loan_id3 = manager.request_loan(&borrower3, &1000);

    manager.approve_loan(&loan_id1);
    manager.approve_loan(&loan_id2);
    manager.approve_loan(&loan_id3);

    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 20_000);

    let loan_ids = soroban_sdk::vec![&env, loan_id1, loan_id2, loan_id3];
    manager.check_defaults(&loan_ids);

    assert_eq!(manager.get_loan(&loan_id1).status, LoanStatus::Defaulted);
    assert_eq!(manager.get_loan(&loan_id2).status, LoanStatus::Defaulted);
    assert_eq!(manager.get_loan(&loan_id3).status, LoanStatus::Defaulted);

    assert!(nft_client.is_seized(&borrower1));
    assert!(nft_client.is_seized(&borrower2));
    assert!(nft_client.is_seized(&borrower3));
}

#[test]
fn test_overdue_repayment_charges_late_fee() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_address, token_id, _token_admin, _treasury_address) =
        setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_address, &10_000);
    stellar_token.mint(&borrower, &10_000);

    manager.set_late_fee_rate(&500);
    env.ledger().set_sequence_number(1);
    let loan_id = manager.request_loan(&borrower, &1000);
    manager.approve_loan(&loan_id);

    let due_date = manager.get_loan(&loan_id).due_date;
    env.ledger().set_sequence_number(due_date + 8_640);

    manager.repay(&borrower, &loan_id, &300);

    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.interest_paid, 180);
    assert_eq!(loan.late_fee_paid, 29);
    assert_eq!(loan.principal_paid, 91);
    assert_eq!(loan.accrued_late_fee, 0);
    assert_eq!(loan.status, LoanStatus::Approved);
    assert_eq!(token_client.balance(&pool_address), 9_300);
}

#[test]
fn test_late_fee_is_capped_at_quarter_principal() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_address, token_id, _token_admin, _treasury_address) =
        setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_address, &10_000);

    manager.set_late_fee_rate(&10_000);
    let loan_id = manager.request_loan(&borrower, &1000);
    manager.approve_loan(&loan_id);

    let due_date = manager.get_loan(&loan_id).due_date;
    env.ledger().set_sequence_number(due_date + 500_000);

    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.accrued_late_fee, 250);
}
