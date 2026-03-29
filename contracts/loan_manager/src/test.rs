use crate::{DataKey, LoanError, LoanManager, LoanManagerClient, LoanStatus};
use lending_pool::{LendingPool, LendingPoolClient};
use remittance_nft::{RemittanceNFT, RemittanceNFTClient};
use soroban_sdk::testutils::Ledger as _;
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

fn setup_test<'a>(
    env: &Env,
) -> (
    LoanManagerClient<'a>,
    RemittanceNFTClient<'a>,
    LendingPoolClient<'a>,
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

    // 3. Deploy a real LendingPool contract for cross-contract pause checks
    let pool_contract_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(env, &pool_contract_id);
    pool_client.initialize(&admin);

    // 4. Deploy the LoanManager contract
    let loan_manager_id = env.register(LoanManager, ());
    let loan_manager_client = LoanManagerClient::new(env, &loan_manager_id);

    // Authorize LoanManager on NFT contract before initialization
    nft_client.authorize_minter(&loan_manager_id);

    // 5. Initialize the Loan Manager with the NFT contract, lending pool, token, and admin
    loan_manager_client.initialize(&nft_contract_id, &pool_contract_id, &token_id, &admin);

    (
        loan_manager_client,
        nft_client,
        pool_client,
        token_id,
        token_admin,
    )
}

fn create_upgrade_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[9u8; 32])
}

#[test]
#[should_panic]
fn test_upgrade_requires_admin_auth() {
    let env = Env::default();
    let (manager, _nft_client, _pool, _token, _token_admin) = setup_test(&env);

    env.mock_auths(&[]);
    manager.upgrade(&create_upgrade_hash(&env));
}

#[test]
fn test_loan_request_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, nft_client, _pool, _token, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);
    assert_eq!(manager.version(), 2);

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
#[should_panic]
fn test_loan_request_failure_low_score() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, nft_client, _pool, _token, _token_admin) = setup_test(&env);
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

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // 1. Give borrower a score high enough to pass
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    // 2. Setup liquidity - mint tokens to the pool address
    let token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &10000);

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
fn test_approve_loan_fails_when_pool_has_insufficient_liquidity() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, _pool_client, _token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let loan_id = manager.request_loan(&borrower, &1_000);
    let result = manager.try_approve_loan(&loan_id);
    assert_eq!(result, Err(Ok(LoanError::InsufficientPoolLiquidity)));

    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Pending);
}

#[test]
fn test_cancel_pending_loan() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, nft_client, _pool, _token, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let loan_id = manager.request_loan(&borrower, &1_000);
    manager.cancel_loan(&borrower, &loan_id);

    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Cancelled);
}

#[test]
fn test_reject_pending_loan() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, nft_client, _pool, _token, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let loan_id = manager.request_loan(&borrower, &1_000);
    manager.reject_loan(&loan_id, &String::from_str(&env, "manual review failed"));

    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Rejected);
}

#[test]
fn test_configurable_interest_rate_and_default_term() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    manager.set_interest_rate(&1_800);
    manager.set_default_term(&20_000);

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &10_000);

    let loan_id = manager.request_loan(&borrower, &1_000);
    let pending_loan = manager.get_loan(&loan_id);
    assert_eq!(pending_loan.interest_rate_bps, 1_800);

    let approval_ledger = env.ledger().sequence();
    manager.approve_loan(&loan_id);

    let approved_loan = manager.get_loan(&loan_id);
    assert_eq!(approved_loan.due_date, approval_ledger + 20_000);
}

#[test]
fn test_set_interest_rate_zero_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, _nft_client, _pool, _token, _token_admin) = setup_test(&env);
    let result = manager.try_set_interest_rate(&0);
    assert_eq!(result, Err(Ok(LoanError::InvalidRate)));
}

#[test]
fn test_legacy_zero_interest_config_falls_back_to_default() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Simulate a legacy/misconfigured zero interest rate in instance storage.
    env.as_contract(&manager.address, || {
        env.storage()
            .instance()
            .set(&DataKey::InterestRateBps, &0u32);
    });

    assert_eq!(manager.get_interest_rate(), 1_200);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &10_000);

    let loan_id = manager.request_loan(&borrower, &1_000);
    let pending_loan = manager.get_loan(&loan_id);
    assert_eq!(pending_loan.interest_rate_bps, 1_200);
}

#[test]
fn test_repayment_flow() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // 1. Borrower starts with a score of 600
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);
    assert_eq!(nft_client.get_score(&borrower), 600);

    let token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &10_000);
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
    assert_eq!(token_client.balance(&pool_client.address), 9_500);

    let remaining_debt = loan.amount + loan.accrued_interest + loan.accrued_late_fee
        - loan.principal_paid
        - loan.interest_paid
        - loan.late_fee_paid;
    manager.repay(&borrower, &loan_id, &remaining_debt);
    let completed = manager.get_loan(&loan_id);
    assert_eq!(completed.status, LoanStatus::Repaid);

    // Score updates include both partial and final repayment contributions.
    assert_eq!(nft_client.get_score(&borrower), 610);
}

#[test]
fn test_partial_repayment_tracks_split_balances() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &2_000_000);
    stellar_token.mint(&borrower, &2_000_000);

    manager.set_max_loan_amount(&1_000_000);
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
#[should_panic(expected = "repayment amount below minimum")]
fn test_minimum_repayment_amount_enforced() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);
    assert_eq!(nft_client.get_score(&borrower), 600);

    let _history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &10_000);
    stellar_token.mint(&borrower, &10_000);

    let loan_id = manager.request_loan(&borrower, &1_000);
    manager.approve_loan(&loan_id);

    manager.set_min_repayment_amount(&150);
    manager.repay(&borrower, &loan_id, &100);
}

#[test]
fn test_full_repayment_ignores_minimum_amount() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);
    assert_eq!(nft_client.get_score(&borrower), 600);

    let _history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &10_000);
    stellar_token.mint(&borrower, &10_000);

    let loan_id = manager.request_loan(&borrower, &1_000);
    manager.approve_loan(&loan_id);

    manager.set_min_repayment_amount(&150);
    manager.repay(&borrower, &loan_id, &1_000);

    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Repaid);
}

#[test]
fn test_request_loan_above_max_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, nft_client, _pool, _token, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &700, &history_hash, &None);
    manager.set_max_loan_amount(&500);

    let result = manager.try_request_loan(&borrower, &600);
    assert_eq!(result, Err(Ok(LoanError::InvalidAmount)));
}

#[test]
fn test_small_repayment_does_not_change_score() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);
    assert_eq!(nft_client.get_score(&borrower), 600);

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &10_000);
    stellar_token.mint(&borrower, &10_000);

    let loan_id = manager.request_loan(&borrower, &1000);
    manager.approve_loan(&loan_id);

    manager.set_min_repayment_amount(&1);
    manager.repay(&borrower, &loan_id, &99);

    assert_eq!(nft_client.get_score(&borrower), 600);
}

#[test]
fn test_late_full_repayment_applies_score_penalty() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &20_000);
    stellar_token.mint(&borrower, &20_000);

    let loan_id = manager.request_loan(&borrower, &1000);
    manager.approve_loan(&loan_id);

    let due_date = manager.get_loan(&loan_id).due_date;
    let grace = manager.get_grace_period_ledgers();
    env.ledger().set_sequence_number(due_date + grace + 1);

    let loan = manager.get_loan(&loan_id);
    let payoff = loan.amount + loan.accrued_interest + loan.accrued_late_fee;
    manager.repay(&borrower, &loan_id, &payoff);

    assert_eq!(manager.get_loan(&loan_id).status, LoanStatus::Repaid);
    assert_eq!(nft_client.get_score(&borrower), 590);
}

#[test]
#[should_panic]
fn test_access_controls_unauthorized_repay() {
    let env = Env::default();
    // NOT using mock_all_auths() to enforce actual signatures

    let (manager, _nft_client, _pool, _token, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Attempting to repay without proper Authorization scope should panic natively.
    manager.repay(&borrower, &1, &500);
}

#[test]
#[should_panic]
fn test_approve_nonexistent_loan() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, _nft, _pool, _token, _token_admin) = setup_test(&env);

    // Try to approve a loan that doesn't exist
    manager.approve_loan(&999);
}

#[test]
#[should_panic]
fn test_approve_already_approved_loan() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Setup
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &10000);

    // Request and approve loan
    let loan_id = manager.request_loan(&borrower, &1000);
    manager.approve_loan(&loan_id);

    // Try to approve again - should panic
    manager.approve_loan(&loan_id);
}

#[test]
fn test_approve_loan_insufficient_pool_liquidity() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &650, &history_hash, &None);

    // Mint only 100 tokens into pool, but loan requests 1000
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &100);

    let loan_id = manager.request_loan(&borrower, &1000);
    let result = manager.try_approve_loan(&loan_id);
    assert_eq!(result, Err(Ok(LoanError::InsufficientPoolLiquidity)));
}

#[test]
fn test_borrower_max_active_loans_enforced_and_released_on_repay() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &700, &history_hash, &None);

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &50_000);
    stellar_token.mint(&borrower, &50_000);

    manager.set_max_loans_per_borrower(&2);

    let loan_1 = manager.request_loan(&borrower, &1000);
    let loan_2 = manager.request_loan(&borrower, &1500);
    manager.approve_loan(&loan_1);
    manager.approve_loan(&loan_2);
    assert_eq!(manager.get_borrower_loan_count(&borrower), 2);

    manager.repay(&borrower, &loan_1, &1000);
    assert_eq!(manager.get_loan(&loan_1).status, LoanStatus::Repaid);
    assert_eq!(manager.get_borrower_loan_count(&borrower), 1);

    let loan_3 = manager.request_loan(&borrower, &500);
    assert_eq!(loan_3, 3);
}

#[test]
#[should_panic]
fn test_borrower_max_active_loans_blocks_new_requests() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &700, &history_hash, &None);

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &50_000);

    manager.set_max_loans_per_borrower(&2);

    let loan_1 = manager.request_loan(&borrower, &1000);
    let loan_2 = manager.request_loan(&borrower, &1500);
    manager.approve_loan(&loan_1);
    manager.approve_loan(&loan_2);
    assert_eq!(manager.get_borrower_loan_count(&borrower), 2);

    manager.request_loan(&borrower, &500);
}

#[test]
#[should_panic]
fn test_request_loan_negative_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, nft_client, _pool, _token, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    manager.request_loan(&borrower, &-1000);
}

#[test]
fn test_check_default_success() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let stellar_token = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &10_000);

    let loan_id = manager.request_loan(&borrower, &1000);
    manager.approve_loan(&loan_id);

    assert!(!nft_client.is_seized(&borrower));

    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 100_000);

    manager.check_default(&loan_id);

    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Defaulted);

    assert_eq!(nft_client.get_default_count(&borrower), 1);
    assert_eq!(nft_client.get_score(&borrower), 550);
    assert!(nft_client.is_seized(&borrower));
}

#[test]
#[should_panic]
fn test_check_default_not_past_due() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let stellar_token = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &10_000);

    let loan_id = manager.request_loan(&borrower, &1000);
    manager.approve_loan(&loan_id);

    manager.check_default(&loan_id);
}

#[test]
#[should_panic]
fn test_check_default_already_repaid() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let stellar_token = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &10_000);
    stellar_token.mint(&borrower, &10_000);

    let loan_id = manager.request_loan(&borrower, &1000);
    manager.approve_loan(&loan_id);

    manager.repay(&borrower, &loan_id, &1000);

    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 40_000);

    manager.check_default(&loan_id);
}

#[test]
fn test_check_default_respects_default_window() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let stellar_token = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &10_000);

    manager.set_default_window_ledgers(&10_000);
    let loan_id = manager.request_loan(&borrower, &1000);
    manager.approve_loan(&loan_id);

    let due_date = manager.get_loan(&loan_id).due_date;
    env.ledger().set_sequence_number(due_date + 9_999);

    let result = manager.try_check_default(&loan_id);
    assert_eq!(result, Err(Ok(LoanError::LoanNotPastDue)));
}

#[test]
fn test_check_defaults_batch() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower1 = Address::generate(&env);
    let borrower2 = Address::generate(&env);
    let borrower3 = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower1, &600, &history_hash, &None);
    nft_client.mint(&borrower2, &600, &history_hash, &None);
    nft_client.mint(&borrower3, &600, &history_hash, &None);

    let stellar_token = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &100_000);

    let loan_id1 = manager.request_loan(&borrower1, &1000);
    let loan_id2 = manager.request_loan(&borrower2, &1000);
    let loan_id3 = manager.request_loan(&borrower3, &1000);

    manager.approve_loan(&loan_id1);
    manager.approve_loan(&loan_id2);
    manager.approve_loan(&loan_id3);

    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 100_000);

    let loan_ids = soroban_sdk::vec![&env, loan_id1, loan_id2, loan_id3];
    manager.check_defaults(&loan_ids);

    assert_eq!(manager.get_loan(&loan_id1).status, LoanStatus::Defaulted);
    assert_eq!(manager.get_loan(&loan_id2).status, LoanStatus::Defaulted);
    assert_eq!(manager.get_loan(&loan_id3).status, LoanStatus::Defaulted);

    assert_eq!(nft_client.get_score(&borrower1), 550);
    assert_eq!(nft_client.get_score(&borrower2), 550);
    assert_eq!(nft_client.get_score(&borrower3), 550);
    assert!(nft_client.is_seized(&borrower1));
    assert!(nft_client.is_seized(&borrower2));
    assert!(nft_client.is_seized(&borrower3));
}

#[test]
fn test_overdue_repayment_charges_late_fee() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &10_000);
    stellar_token.mint(&borrower, &10_000);

    manager.set_late_fee_rate(&500);
    manager.set_grace_period_ledgers(&0);
    env.ledger().set_sequence_number(1);
    let loan_id = manager.request_loan(&borrower, &1000);
    manager.approve_loan(&loan_id);

    let due_date = manager.get_loan(&loan_id).due_date;
    env.ledger().set_sequence_number(due_date + 8_640);

    manager.repay(&borrower, &loan_id, &300);

    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.interest_paid, 45);
    assert_eq!(loan.late_fee_paid, 7);
    assert_eq!(loan.principal_paid, 248);
    assert_eq!(loan.accrued_interest, 135);
    assert_eq!(loan.accrued_late_fee, 22);
    assert_eq!(loan.status, LoanStatus::Approved);
    assert_eq!(token_client.balance(&pool_client.address), 9_300);
}

#[test]
fn test_overdue_partial_repayment_still_reduces_principal() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &10_000);
    stellar_token.mint(&borrower, &10_000);

    manager.set_late_fee_rate(&500);
    manager.set_grace_period_ledgers(&0);
    env.ledger().set_sequence_number(1);
    let loan_id = manager.request_loan(&borrower, &1_000);
    manager.approve_loan(&loan_id);

    let due_date = manager.get_loan(&loan_id).due_date;
    env.ledger().set_sequence_number(due_date + 8_640);

    manager.repay(&borrower, &loan_id, &300);

    let loan = manager.get_loan(&loan_id);
    assert!(loan.principal_paid > 0);
    assert!(loan.accrued_late_fee > 0);
    assert_eq!(
        loan.principal_paid + loan.interest_paid + loan.late_fee_paid,
        300
    );
}

#[test]
fn test_late_fee_is_capped_at_quarter_principal() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &10_000);

    manager.set_late_fee_rate(&10_000);
    manager.set_grace_period_ledgers(&0);
    let loan_id = manager.request_loan(&borrower, &1000);
    manager.approve_loan(&loan_id);

    let due_date = manager.get_loan(&loan_id).due_date;
    env.ledger().set_sequence_number(due_date + 500_000);

    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.accrued_late_fee, 250);
}

#[test]
fn test_deposit_collateral_and_auto_release_on_full_repayment() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &650, &history_hash, &None);

    let token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &20_000);
    stellar_token.mint(&borrower, &20_000);

    let loan_id = manager.request_loan(&borrower, &1_000);
    manager.approve_loan(&loan_id);

    let contract_balance_before = token_client.balance(&manager.address);
    manager.deposit_collateral(&loan_id, &300);

    assert_eq!(manager.get_collateral(&loan_id), 300);
    assert_eq!(
        token_client.balance(&manager.address),
        contract_balance_before + 300
    );

    let borrower_balance_before_full_repay = token_client.balance(&borrower);
    manager.repay(&borrower, &loan_id, &1_000);

    assert_eq!(manager.get_loan(&loan_id).status, LoanStatus::Repaid);
    assert_eq!(manager.get_collateral(&loan_id), 0);
    assert_eq!(
        token_client.balance(&borrower),
        borrower_balance_before_full_repay - 1_000 + 300
    );
}

#[test]
fn test_collateral_is_seized_on_default() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &650, &history_hash, &None);

    let token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &20_000);
    stellar_token.mint(&borrower, &20_000);

    let loan_id = manager.request_loan(&borrower, &1_000);
    manager.approve_loan(&loan_id);
    manager.deposit_collateral(&loan_id, &400);

    let pool_balance_before_default = token_client.balance(&pool_client.address);
    let contract_balance_before_default = token_client.balance(&manager.address);

    let due_date = manager.get_loan(&loan_id).due_date;
    let default_window = manager.get_default_window_ledgers();
    env.ledger()
        .set_sequence_number(due_date + default_window + 1);
    manager.check_default(&loan_id);

    assert_eq!(manager.get_loan(&loan_id).status, LoanStatus::Defaulted);
    assert_eq!(manager.get_collateral(&loan_id), 0);
    assert_eq!(
        token_client.balance(&pool_client.address),
        pool_balance_before_default + 400
    );
    assert_eq!(
        token_client.balance(&manager.address),
        contract_balance_before_default - 400
    );
}

#[test]
fn test_collateral_is_seized_on_batch_default() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower1 = Address::generate(&env);
    let borrower2 = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower1, &650, &history_hash, &None);
    nft_client.mint(&borrower2, &650, &history_hash, &None);

    let token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &50_000);
    stellar_token.mint(&borrower1, &20_000);
    stellar_token.mint(&borrower2, &20_000);

    let loan_id1 = manager.request_loan(&borrower1, &1_000);
    let loan_id2 = manager.request_loan(&borrower2, &1_000);
    manager.approve_loan(&loan_id1);
    manager.approve_loan(&loan_id2);
    manager.deposit_collateral(&loan_id1, &300);
    manager.deposit_collateral(&loan_id2, &500);

    let pool_balance_before = token_client.balance(&pool_client.address);

    let due_date = manager.get_loan(&loan_id1).due_date;
    let default_window = manager.get_default_window_ledgers();
    env.ledger()
        .set_sequence_number(due_date + default_window + 1);

    let loan_ids = soroban_sdk::vec![&env, loan_id1, loan_id2];
    manager.check_defaults(&loan_ids);

    assert_eq!(manager.get_collateral(&loan_id1), 0);
    assert_eq!(manager.get_collateral(&loan_id2), 0);
    assert_eq!(
        token_client.balance(&pool_client.address),
        pool_balance_before + 300 + 500
    );
}

#[test]
#[should_panic]
fn test_deposit_collateral_rejects_non_active_loan() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, nft_client, _pool, _token, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &700, &history_hash, &None);

    let loan_id = manager.request_loan(&borrower, &500);
    manager.deposit_collateral(&loan_id, &100);
}

#[test]
fn test_pool_paused_blocks_loan_approval() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &10_000);

    let loan_id = manager.request_loan(&borrower, &1_000);

    // Pause the lending pool
    pool_client.pause();
    assert!(pool_client.is_paused());

    // LoanManager should detect the pool is paused and return PoolPaused
    let result = manager.try_approve_loan(&loan_id);
    assert_eq!(result, Err(Ok(LoanError::PoolPaused)));

    // Also verify request_loan is blocked
    let result2 = manager.try_request_loan(&borrower, &500);
    assert_eq!(result2, Err(Ok(LoanError::PoolPaused)));
}

#[test]
fn test_pool_unpaused_allows_loan_approval() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &10_000);

    let loan_id = manager.request_loan(&borrower, &1_000);

    // Pause then unpause the lending pool
    pool_client.pause();
    assert!(pool_client.is_paused());
    pool_client.unpause();
    assert!(!pool_client.is_paused());

    // Approval should succeed after unpause
    manager.approve_loan(&loan_id);
    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Approved);
}

#[test]
fn test_nft_paused_blocks_loan_approval() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &600, &history_hash, &None);

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &10_000);

    let loan_id = manager.request_loan(&borrower, &1_000);

    // Pause the NFT contract
    nft_client.pause();
    assert!(nft_client.is_paused());

    // LoanManager should detect the NFT contract is paused and return NftPaused
    let result = manager.try_approve_loan(&loan_id);
    assert_eq!(result, Err(Ok(LoanError::NftPaused)));
}

#[test]
fn test_set_default_window_zero_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, _nft_client, _pool, _token, _token_admin) = setup_test(&env);
    let result = manager.try_set_default_window_ledgers(&0);
    assert_eq!(result, Err(Ok(LoanError::InvalidConfiguration)));
}

#[test]
fn test_set_default_window_below_minimum_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, _nft_client, _pool, _token, _token_admin) = setup_test(&env);
    let result = manager.try_set_default_window_ledgers(&99);
    assert_eq!(result, Err(Ok(LoanError::InvalidConfiguration)));
}

// ───────────────────────── Liquidation Tests ─────────────────────────

#[test]
fn test_liquidation_default_threshold_and_bonus() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, _nft_client, _pool, _token, _token_admin) = setup_test(&env);

    // Defaults: 15000 bps (150%) threshold, 500 bps (5%) bonus
    assert_eq!(manager.get_liquidation_threshold(), 15_000);
    assert_eq!(manager.get_liquidation_bonus(), 500);
}

#[test]
fn test_set_liquidation_threshold_and_bonus() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, _nft_client, _pool, _token, _token_admin) = setup_test(&env);

    manager.set_liquidation_threshold(&12_000);
    assert_eq!(manager.get_liquidation_threshold(), 12_000);

    manager.set_liquidation_bonus(&1_000);
    assert_eq!(manager.get_liquidation_bonus(), 1_000);
}

#[test]
fn test_set_liquidation_threshold_zero_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, _nft_client, _pool, _token, _token_admin) = setup_test(&env);
    let result = manager.try_set_liquidation_threshold(&0);
    assert_eq!(result, Err(Ok(LoanError::InvalidConfiguration)));
}

#[test]
fn test_set_liquidation_threshold_too_high_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, _nft_client, _pool, _token, _token_admin) = setup_test(&env);
    let result = manager.try_set_liquidation_threshold(&50_001);
    assert_eq!(result, Err(Ok(LoanError::InvalidConfiguration)));
}

#[test]
fn test_set_liquidation_bonus_too_high_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, _nft_client, _pool, _token, _token_admin) = setup_test(&env);
    let result = manager.try_set_liquidation_bonus(&5_001);
    assert_eq!(result, Err(Ok(LoanError::InvalidConfiguration)));
}

#[test]
fn test_liquidate_happy_path() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &650, &history_hash, &None);

    let token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &20_000);
    stellar_token.mint(&borrower, &20_000);

    // Request and approve a loan of 1000
    let loan_id = manager.request_loan(&borrower, &1_000);
    manager.approve_loan(&loan_id);

    // Deposit 1200 collateral (120% ratio, below 150% threshold)
    manager.deposit_collateral(&loan_id, &1_200);

    // Collateral ratio = 1200 * 10000 / 1000 = 12000 bps (120%)
    // Threshold = 15000 bps (150%), so ratio < threshold → eligible

    let liquidator_balance_before = token_client.balance(&liquidator);
    let borrower_balance_before = token_client.balance(&borrower);

    manager.liquidate(&loan_id, &liquidator);

    // Verify loan status is Liquidated
    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Liquidated);
    assert_eq!(loan.collateral_amount, 0);

    // Liquidator bonus = 1200 * 500 / 10000 = 60
    let liquidator_bonus = 1_200i128 * 500 / 10_000;
    assert_eq!(liquidator_bonus, 60);

    // Borrower remainder = 1200 - 60 = 1140
    let borrower_remainder = 1_200 - liquidator_bonus;
    assert_eq!(borrower_remainder, 1_140);

    assert_eq!(
        token_client.balance(&liquidator),
        liquidator_balance_before + liquidator_bonus
    );
    assert_eq!(
        token_client.balance(&borrower),
        borrower_balance_before + borrower_remainder
    );
}

#[test]
fn test_liquidate_over_threshold_rejected() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &650, &history_hash, &None);

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &20_000);
    stellar_token.mint(&borrower, &20_000);

    let loan_id = manager.request_loan(&borrower, &1_000);
    manager.approve_loan(&loan_id);

    // Deposit 2000 collateral (200% ratio, above 150% threshold)
    manager.deposit_collateral(&loan_id, &2_000);

    let result = manager.try_liquidate(&loan_id, &liquidator);
    assert_eq!(result, Err(Ok(LoanError::LoanNotUndercollateralized)));
}

#[test]
fn test_liquidate_already_liquidated_rejected() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &650, &history_hash, &None);

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &20_000);
    stellar_token.mint(&borrower, &20_000);

    let loan_id = manager.request_loan(&borrower, &1_000);
    manager.approve_loan(&loan_id);

    // Deposit under-collateralized amount
    manager.deposit_collateral(&loan_id, &1_200);

    // First liquidation succeeds
    manager.liquidate(&loan_id, &liquidator);
    assert_eq!(manager.get_loan(&loan_id).status, LoanStatus::Liquidated);

    // Second liquidation fails
    let result = manager.try_liquidate(&loan_id, &liquidator);
    assert_eq!(result, Err(Ok(LoanError::LoanAlreadyLiquidated)));
}

#[test]
fn test_liquidate_non_active_loan_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, nft_client, _pool, _token, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &650, &history_hash, &None);

    // Loan is Pending, not Approved
    let loan_id = manager.request_loan(&borrower, &500);
    let result = manager.try_liquidate(&loan_id, &liquidator);
    assert_eq!(result, Err(Ok(LoanError::LoanNotActive)));
}

#[test]
fn test_liquidate_with_custom_threshold_and_bonus() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &650, &history_hash, &None);

    let token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &20_000);
    stellar_token.mint(&borrower, &20_000);

    // Set custom threshold to 120% (12000 bps) and bonus to 10% (1000 bps)
    manager.set_liquidation_threshold(&12_000);
    manager.set_liquidation_bonus(&1_000);

    let loan_id = manager.request_loan(&borrower, &1_000);
    manager.approve_loan(&loan_id);

    // Deposit 1100 collateral (110% ratio, below 120% threshold)
    manager.deposit_collateral(&loan_id, &1_100);

    let liquidator_balance_before = token_client.balance(&liquidator);
    let borrower_balance_before = token_client.balance(&borrower);

    manager.liquidate(&loan_id, &liquidator);

    // Liquidator bonus = 1100 * 1000 / 10000 = 110
    let liquidator_bonus = 1_100i128 * 1_000 / 10_000;
    assert_eq!(liquidator_bonus, 110);

    // Borrower remainder = 1100 - 110 = 990
    let borrower_remainder = 1_100 - liquidator_bonus;
    assert_eq!(borrower_remainder, 990);

    assert_eq!(
        token_client.balance(&liquidator),
        liquidator_balance_before + liquidator_bonus
    );
    assert_eq!(
        token_client.balance(&borrower),
        borrower_balance_before + borrower_remainder
    );

    assert_eq!(manager.get_loan(&loan_id).status, LoanStatus::Liquidated);
}

#[test]
fn test_liquidate_decrements_borrower_loan_count() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(&borrower, &650, &history_hash, &None);

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client.address, &20_000);
    stellar_token.mint(&borrower, &20_000);

    let loan_id = manager.request_loan(&borrower, &1_000);
    manager.approve_loan(&loan_id);
    assert_eq!(manager.get_borrower_loan_count(&borrower), 1);

    manager.deposit_collateral(&loan_id, &1_200);
    manager.liquidate(&loan_id, &liquidator);

    assert_eq!(manager.get_borrower_loan_count(&borrower), 0);
}

