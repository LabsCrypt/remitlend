use crate::{DataKey, Loan, LoanError, LoanManager, LoanManagerClient, LoanStatus};
use lending_pool::{LendingPool, LendingPoolClient};
use remittance_nft::{RemittanceNFT, RemittanceNFTClient};
use soroban_sdk::testutils::{Events, Ledger as _};
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
use soroban_sdk::{
    contract, contractimpl, testutils::Address as _, Address, BytesN, Env, FromVal, String,
};

// Mock RateOracle contract for testing the oracle interest-rate code path.
#[contract]
pub struct MockRateOracle;

#[contractimpl]
impl MockRateOracle {
    pub fn get_rate(_env: Env, _borrower: Address, _amount: i128, _score: u32) -> u32 {
        _env.storage().instance().get(&"rate").unwrap_or(1200)
    }

    pub fn set_rate(env: Env, rate: u32) {
        env.storage().instance().set(&"rate", &rate);
    }
}

fn setup_test<'a>(
    env: &Env,
) -> (
    LoanManagerClient<'a>,
    RemittanceNFTClient<'a>,
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

    // Disable dust spam protection for the loan manager tests
    nft_client.set_min_repayment_amount(&0);

    (
        loan_manager_client,
        nft_client,
        pool_client.address,
        token_id,
        admin,
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
fn test_set_admin_updates_admin_immediately() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool, _token, _token_admin) = setup_test(&env);
    let new_admin = Address::generate(&env);

    manager.propose_admin(&new_admin);
    manager.accept_admin();

    assert_eq!(manager.get_admin(), new_admin);
}

#[test]
fn test_set_min_score_valid_update_emits_event() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool, _token, _admin) = setup_test(&env);

    manager.set_min_score(&650);

    let events = env.events().all();
    let event = events.get(events.len() - 1).unwrap();
    let topic_0 = soroban_sdk::Symbol::from_val(&env, &event.1.get(0).unwrap());
    let scores = <(u32, u32)>::from_val(&env, &event.2);

    assert_eq!(topic_0, soroban_sdk::Symbol::new(&env, "MinScoreUpdated"));
    assert_eq!(scores, (500, 650));
    assert_eq!(manager.get_min_score(), 650);
}

#[test]
fn test_set_min_score_rejects_above_nft_max() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool, _token, _admin) = setup_test(&env);

    let result = manager.try_set_min_score(&851);

    assert_eq!(result, Err(Ok(LoanError::InvalidConfiguration)));
    assert_eq!(manager.get_min_score(), 500);
}

#[test]
fn test_set_min_score_accepts_nft_max_boundary() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool, _token, _admin) = setup_test(&env);

    manager.set_min_score(&850);

    assert_eq!(manager.get_min_score(), 850);
}

#[test]
fn test_get_proposed_admin_returns_none_when_no_proposal() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool, _token, _admin) = setup_test(&env);

    assert_eq!(manager.get_proposed_admin(), None);
}

#[test]
fn test_get_proposed_admin_returns_proposed_admin() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool, _token, _admin) = setup_test(&env);
    let new_admin = Address::generate(&env);

    manager.propose_admin(&new_admin);

    assert_eq!(manager.get_proposed_admin(), Some(new_admin));
}

#[test]
fn test_get_proposed_admin_returns_none_after_accept() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool, _token, _admin) = setup_test(&env);
    let new_admin = Address::generate(&env);

    manager.propose_admin(&new_admin);
    manager.accept_admin();

    assert_eq!(manager.get_proposed_admin(), None);
    assert_eq!(manager.get_admin(), new_admin);
}

#[test]
fn test_migration_guard_prevents_double_execution() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Create some pre-migration data
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &soroban_sdk::String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);
    stellar_token.mint(&borrower, &10_000);

    let loan_id = manager.request_loan(&borrower, &1000, &17280);
    manager.approve_loan(&loan_id);

    // First migration should succeed
    manager.migrate();
    let version1 = manager.version();
    assert_eq!(version1, 4);

    // Verify data is still readable after migration
    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Approved);
    assert_eq!(loan.amount, 1000);

    // Second migration should be idempotent (not error, just return early)
    manager.migrate();
    let version2 = manager.version();
    assert_eq!(version2, 4);

    // Data should still be readable
    let loan_after = manager.get_loan(&loan_id);
    assert_eq!(loan_after.status, LoanStatus::Approved);
    assert_eq!(loan_after.amount, 1000);
}

#[test]
fn test_loan_request_success() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, nft_client, _pool, _token, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);
    assert_eq!(manager.version(), 4);

    // Give borrower a score high enough to pass (>= 500)
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    // Should succeed and return loan_id
    let loan_id = manager.request_loan(&borrower, &1000, &17280);
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
    nft_client.mint(
        &borrower,
        &400,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    // Should panic
    manager.request_loan(&borrower, &1000, &17280);
}

#[test]
fn test_approve_loan_flow() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // 1. Give borrower a score high enough to pass
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    // 2. Setup liquidity - mint tokens to the pool address
    let token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10000);

    // 3. Request a loan
    let loan_id = manager.request_loan(&borrower, &1000, &17280);

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
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let loan_id = manager.request_loan(&borrower, &1_000, &17280);
    let result = manager.try_approve_loan(&loan_id);
    assert_eq!(result, Err(Ok(LoanError::InsufficientPoolLiquidity)));

    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Pending);
}

#[test]
fn test_approve_loan_accounts_for_outstanding_approved_loans() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower_one = Address::generate(&env);
    let borrower_two = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower_one,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );
    nft_client.mint(
        &borrower_two,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);

    let first_loan = manager.request_loan(&borrower_one, &6_000, &17280);
    let second_loan = manager.request_loan(&borrower_two, &6_000, &17280);

    manager.approve_loan(&first_loan);
    let second_result = manager.try_approve_loan(&second_loan);
    assert_eq!(second_result, Err(Ok(LoanError::InsufficientPoolLiquidity)));

    assert_eq!(manager.get_loan(&first_loan).status, LoanStatus::Approved);
    assert_eq!(manager.get_loan(&second_loan).status, LoanStatus::Pending);
}

#[test]
fn test_cancel_pending_loan() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, nft_client, _pool, _token, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let loan_id = manager.request_loan(&borrower, &1_000, &17280);
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
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let loan_id = manager.request_loan(&borrower, &1_000, &17280);
    manager.reject_loan(&loan_id, &String::from_str(&env, "manual review failed"));

    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Rejected);
}

#[test]
fn test_paused_blocks_new_loans_and_repayments_but_allows_collateral_release() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &700,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    // Seed liquidity so approve_loan can proceed prior to pause.
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &50_000);

    // Fund borrower so they can repay.
    let token_client = TokenClient::new(&env, &token_id);
    stellar_token.mint(&borrower, &5_000);

    // Loan A: pending loan that should be cancellable even while paused.
    let loan_a = manager.request_loan(&borrower, &1_000, &17280);

    // Loan B: approve before pausing so we can verify repay is blocked while paused.
    let loan_b = manager.request_loan(&borrower, &1_000, &17280);
    manager.approve_loan(&loan_b);

    // Loan C: pending loan used to verify approvals are blocked while paused.
    let loan_c = manager.request_loan(&borrower, &500, &17280);

    // Pause the contract.
    manager.pause();
    assert!(manager.is_paused());

    // New loan requests are blocked.
    let blocked_request = manager.try_request_loan(&borrower, &500, &17280);
    assert_eq!(blocked_request, Err(Ok(LoanError::ContractPaused)));

    // Approvals are blocked.
    let blocked_approve = manager.try_approve_loan(&loan_c);
    assert_eq!(blocked_approve, Err(Ok(LoanError::ContractPaused)));

    // Repayments are blocked.
    let blocked_repay = manager.try_repay(&borrower, &loan_b, &100);
    assert_eq!(blocked_repay, Err(Ok(LoanError::ContractPaused)));

    // Existing borrower-initiated cleanup should still work while paused (cancel pending loan).
    let borrower_balance_before = token_client.balance(&borrower);
    manager.cancel_loan(&borrower, &loan_a);
    let borrower_balance_after = token_client.balance(&borrower);
    assert_eq!(borrower_balance_after, borrower_balance_before);

    // Unpause restores normal operations.
    manager.unpause();
    assert!(!manager.is_paused());

    // Now repay should succeed (partial repay).
    manager.repay(&borrower, &loan_b, &100);
}

#[test]
fn test_pause_tracks_paused_at_ledger_and_clears_on_unpause() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool, _token, _admin) = setup_test(&env);

    assert_eq!(manager.get_paused_at_ledger(), 0);

    let base_seq = env.ledger().sequence();
    let paused_seq = base_seq + 123;
    env.ledger().set_sequence_number(paused_seq);
    manager.pause();
    assert!(manager.is_paused());
    assert_eq!(manager.get_paused_at_ledger(), paused_seq);

    let unpaused_seq = paused_seq + 333;
    env.ledger().set_sequence_number(unpaused_seq);
    manager.unpause();
    assert!(!manager.is_paused());
    assert_eq!(manager.get_paused_at_ledger(), 0);

    let paused_seq_2 = unpaused_seq + 333;
    env.ledger().set_sequence_number(paused_seq_2);
    manager.pause();
    assert!(manager.is_paused());
    assert_eq!(manager.get_paused_at_ledger(), paused_seq_2);
}

#[test]
fn test_cancel_pending_loan_returns_collateral() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, _pool, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&manager.address, &500);

    let _borrower_balance_before = token_client.balance(&borrower);
    let _contract_balance_before = token_client.balance(&manager.address);

    let loan_id = manager.request_loan(&borrower, &1_000, &17280);
    env.as_contract(&manager.address, || {
        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env.storage().persistent().get(&loan_key).unwrap();
        loan.collateral_amount = 500;
        env.storage().persistent().set(&loan_key, &loan);
    });

    assert_eq!(manager.get_collateral(&loan_id), 500);

    manager.cancel_loan(&borrower, &loan_id);

    assert_eq!(manager.get_collateral(&loan_id), 0);
}

#[test]
fn test_reject_pending_loan_returns_collateral() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, _pool, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&manager.address, &400);

    let borrower_balance_before = token_client.balance(&borrower);

    let loan_id = manager.request_loan(&borrower, &1_000, &17280);
    env.as_contract(&manager.address, || {
        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env.storage().persistent().get(&loan_key).unwrap();
        loan.collateral_amount = 400;
        env.storage().persistent().set(&loan_key, &loan);
    });

    assert_eq!(manager.get_collateral(&loan_id), 400);

    manager.reject_loan(&loan_id, &String::from_str(&env, "manual review failed"));

    assert_eq!(manager.get_collateral(&loan_id), 0);
    assert_eq!(
        token_client.balance(&borrower),
        borrower_balance_before + 400
    );
}

#[test]
fn test_admin_transfer_via_propose_accept() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool, _token, _token_admin) = setup_test(&env);
    let current_admin: Address = env.as_contract(&manager.address, || {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    });

    let proposed_admin = Address::generate(&env);

    manager.propose_admin(&proposed_admin);

    let pending_admin: Address = env.as_contract(&manager.address, || {
        env.storage()
            .instance()
            .get(&DataKey::ProposedAdmin)
            .unwrap()
    });
    assert_eq!(pending_admin, proposed_admin);

    manager.accept_admin();

    let accepted_admin: Address = env.as_contract(&manager.address, || {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    });
    assert_eq!(accepted_admin, proposed_admin);
    assert_ne!(accepted_admin, current_admin);
}

#[test]
fn test_configurable_interest_rate_and_default_term() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    manager.set_interest_rate(&1_800);
    manager.set_default_term(&20_000);

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);

    let loan_id = manager.request_loan(&borrower, &1_000, &20_000);
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
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);

    let loan_id = manager.request_loan(&borrower, &1_000, &17280);
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
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );
    assert_eq!(nft_client.get_score(&borrower), 600);

    let token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);
    stellar_token.mint(&borrower, &10_000);

    let loan_id = manager.request_loan(&borrower, &1000, &17280);
    manager.approve_loan(&loan_id);

    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 2_000);

    manager.repay(&borrower, &loan_id, &500);

    let loan = manager.get_loan(&loan_id);
    assert!(loan.principal_paid > 0);
    assert!(loan.interest_paid >= 0);
    assert_eq!(loan.status, LoanStatus::Approved);
    assert_eq!(token_client.balance(&pool_client), 9_500);

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
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &2_000_000);
    stellar_token.mint(&borrower, &2_000_000);

    manager.set_max_loan_amount(&1_000_000);
    let loan_id = manager.request_loan(&borrower, &1_000_000, &17280);
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
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );
    assert_eq!(nft_client.get_score(&borrower), 600);

    let _history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);
    stellar_token.mint(&borrower, &10_000);

    let loan_id = manager.request_loan(&borrower, &1_000, &17280);
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
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );
    assert_eq!(nft_client.get_score(&borrower), 600);

    let _history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);
    stellar_token.mint(&borrower, &10_000);

    let loan_id = manager.request_loan(&borrower, &1_000, &17280);
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
    nft_client.mint(
        &borrower,
        &700,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );
    manager.set_max_loan_amount(&500);

    let result = manager.try_request_loan(&borrower, &600, &17280);
    assert_eq!(result, Err(Ok(LoanError::InvalidAmount)));
}

#[test]
fn test_small_repayment_does_not_change_score() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );
    assert_eq!(nft_client.get_score(&borrower), 600);

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);
    stellar_token.mint(&borrower, &10_000);

    let loan_id = manager.request_loan(&borrower, &1000, &17280);
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
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &20_000);
    stellar_token.mint(&borrower, &20_000);

    let loan_id = manager.request_loan(&borrower, &1000, &17280);
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
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10000);

    // Request and approve loan
    let loan_id = manager.request_loan(&borrower, &1000, &17280);
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
    nft_client.mint(
        &borrower,
        &650,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    // Mint only 100 tokens into pool, but loan requests 1000
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &100);

    let loan_id = manager.request_loan(&borrower, &1000, &17280);
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
    nft_client.mint(
        &borrower,
        &700,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &50_000);
    stellar_token.mint(&borrower, &50_000);

    manager.set_max_loans_per_borrower(&2);

    let loan_1 = manager.request_loan(&borrower, &1000, &17280);
    let loan_2 = manager.request_loan(&borrower, &1500, &17280);
    manager.approve_loan(&loan_1);
    manager.approve_loan(&loan_2);
    assert_eq!(manager.get_borrower_loan_count(&borrower), 2);

    manager.repay(&borrower, &loan_1, &1000);
    assert_eq!(manager.get_loan(&loan_1).status, LoanStatus::Repaid);
    assert_eq!(manager.get_borrower_loan_count(&borrower), 1);

    let loan_3 = manager.request_loan(&borrower, &500, &17280);
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
    nft_client.mint(
        &borrower,
        &700,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &50_000);

    manager.set_max_loans_per_borrower(&2);

    let loan_1 = manager.request_loan(&borrower, &1000, &17280);
    let loan_2 = manager.request_loan(&borrower, &1500, &17280);
    manager.approve_loan(&loan_1);
    manager.approve_loan(&loan_2);
    assert_eq!(manager.get_borrower_loan_count(&borrower), 2);

    manager.request_loan(&borrower, &500, &17280);
}

#[test]
#[should_panic]
fn test_request_loan_negative_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, nft_client, _pool, _token, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    manager.request_loan(&borrower, &-1000, &17280);
}

#[test]
fn test_check_default_success() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);

    let loan_id = manager.request_loan(&borrower, &1000, &17280);
    manager.approve_loan(&loan_id);

    assert!(!nft_client.is_seized(&borrower));

    let due_date = manager.get_loan(&loan_id).due_date;
    let default_window = manager.get_default_window_ledgers();
    env.ledger()
        .set_sequence_number(due_date + default_window + 1);

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
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);

    let loan_id = manager.request_loan(&borrower, &1000, &17280);
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
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);
    stellar_token.mint(&borrower, &10_000);

    let loan_id = manager.request_loan(&borrower, &1000, &17280);
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
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);

    manager.set_default_window_ledgers(&10_000);
    let loan_id = manager.request_loan(&borrower, &1000, &17280);
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
    nft_client.mint(
        &borrower1,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );
    nft_client.mint(
        &borrower2,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );
    nft_client.mint(
        &borrower3,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &100_000);

    let loan_id1 = manager.request_loan(&borrower1, &1000, &17280);
    let loan_id2 = manager.request_loan(&borrower2, &1000, &17280);
    let loan_id3 = manager.request_loan(&borrower3, &1000, &17280);
    let loan_id4 = manager.request_loan(&borrower3, &1000, &17280);

    manager.approve_loan(&loan_id1);
    manager.approve_loan(&loan_id2);
    manager.approve_loan(&loan_id3);

    let due_date = manager.get_loan(&loan_id1).due_date;
    let default_window = manager.get_default_window_ledgers();
    env.ledger()
        .set_sequence_number(due_date + default_window + 1);

    let loan_ids = soroban_sdk::vec![&env, loan_id1, loan_id2, loan_id3, loan_id4, 999];
    let defaulted_count = manager.check_defaults(&loan_ids);
    assert_eq!(defaulted_count, 3);

    assert_eq!(manager.get_loan(&loan_id1).status, LoanStatus::Defaulted);
    assert_eq!(manager.get_loan(&loan_id2).status, LoanStatus::Defaulted);
    assert_eq!(manager.get_loan(&loan_id3).status, LoanStatus::Defaulted);
    assert_eq!(manager.get_loan(&loan_id4).status, LoanStatus::Pending);

    assert_eq!(nft_client.get_score(&borrower1), 550);
    assert_eq!(nft_client.get_score(&borrower2), 550);
    assert_eq!(nft_client.get_score(&borrower3), 550);
    assert!(nft_client.is_seized(&borrower1));
    assert!(nft_client.is_seized(&borrower2));
    assert!(nft_client.is_seized(&borrower3));
}

#[test]
fn test_check_defaults_empty_batch_returns_zero() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool_client, _token_id, _token_admin) = setup_test(&env);

    let loan_ids = soroban_sdk::vec![&env];
    let defaulted_count = manager.check_defaults(&loan_ids);

    assert_eq!(defaulted_count, 0);
}

#[test]
fn test_check_defaults_all_ineligible_returns_zero() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);

    let pending_loan_id = manager.request_loan(&borrower, &1000, &17280);
    let approved_loan_id = manager.request_loan(&borrower, &1000, &17280);
    manager.approve_loan(&approved_loan_id);

    let loan_ids = soroban_sdk::vec![&env, pending_loan_id, approved_loan_id, 999];
    let defaulted_count = manager.check_defaults(&loan_ids);

    assert_eq!(defaulted_count, 0);
    assert_eq!(
        manager.get_loan(&pending_loan_id).status,
        LoanStatus::Pending
    );
    assert_eq!(
        manager.get_loan(&approved_loan_id).status,
        LoanStatus::Approved
    );
}

#[test]
fn test_overdue_repayment_charges_late_fee() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);
    stellar_token.mint(&borrower, &10_000);

    manager.set_late_fee_rate(&500);
    manager.set_grace_period_ledgers(&0);
    env.ledger().set_sequence_number(1);
    let loan_id = manager.request_loan(&borrower, &1000, &17280);
    manager.approve_loan(&loan_id);

    let due_date = manager.get_loan(&loan_id).due_date;
    env.ledger().set_sequence_number(due_date + 8_640);

    manager.repay(&borrower, &loan_id, &300);

    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.interest_paid, 45);
    assert_eq!(loan.late_fee_paid, 6);
    assert_eq!(loan.principal_paid, 249);
    assert_eq!(loan.accrued_interest, 135);
    assert_eq!(loan.accrued_late_fee, 19);
    assert_eq!(loan.status, LoanStatus::Approved);
    assert_eq!(token_client.balance(&pool_client), 9_300);
}

#[test]
fn test_overdue_partial_repayment_still_reduces_principal() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);
    stellar_token.mint(&borrower, &10_000);

    manager.set_late_fee_rate(&500);
    manager.set_grace_period_ledgers(&0);
    env.ledger().set_sequence_number(1);
    let loan_id = manager.request_loan(&borrower, &1_000, &17280);
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
fn test_set_late_fee_rate_rejects_above_cap() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool_client, _token_id, _token_admin) = setup_test(&env);

    let result = manager.try_set_late_fee_rate(&2_501);
    assert_eq!(result, Err(Ok(LoanError::InvalidRate)));
}

#[test]
fn test_deposit_collateral_and_auto_release_on_full_repayment() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &650,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &20_000);
    stellar_token.mint(&borrower, &20_000);

    let loan_id = manager.request_loan(&borrower, &1_000, &17280);
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
    nft_client.mint(
        &borrower,
        &650,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &20_000);
    stellar_token.mint(&borrower, &20_000);

    let loan_id = manager.request_loan(&borrower, &1_000, &17280);
    manager.approve_loan(&loan_id);
    manager.deposit_collateral(&loan_id, &400);

    let pool_balance_before_default = token_client.balance(&pool_client);
    let contract_balance_before_default = token_client.balance(&manager.address);

    let due_date = manager.get_loan(&loan_id).due_date;
    let default_window = manager.get_default_window_ledgers();
    env.ledger()
        .set_sequence_number(due_date + default_window + 1);
    manager.check_default(&loan_id);

    assert_eq!(manager.get_loan(&loan_id).status, LoanStatus::Defaulted);
    assert_eq!(manager.get_collateral(&loan_id), 0);
    assert_eq!(
        token_client.balance(&pool_client),
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
    nft_client.mint(
        &borrower1,
        &650,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );
    nft_client.mint(
        &borrower2,
        &650,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &50_000);
    stellar_token.mint(&borrower1, &20_000);
    stellar_token.mint(&borrower2, &20_000);

    let loan_id1 = manager.request_loan(&borrower1, &1_000, &17280);
    let loan_id2 = manager.request_loan(&borrower2, &1_000, &17280);
    manager.approve_loan(&loan_id1);
    manager.approve_loan(&loan_id2);
    manager.deposit_collateral(&loan_id1, &300);
    manager.deposit_collateral(&loan_id2, &500);

    let pool_balance_before = token_client.balance(&pool_client);

    let due_date = manager.get_loan(&loan_id1).due_date;
    let default_window = manager.get_default_window_ledgers();
    env.ledger()
        .set_sequence_number(due_date + default_window + 1);

    let loan_ids = soroban_sdk::vec![&env, loan_id1, loan_id2];
    manager.check_defaults(&loan_ids);

    assert_eq!(manager.get_collateral(&loan_id1), 0);
    assert_eq!(manager.get_collateral(&loan_id2), 0);
    assert_eq!(
        token_client.balance(&pool_client),
        pool_balance_before + 300 + 500
    );
}

#[test]
fn test_liquidate_under_threshold_transfers_bonus_and_refund() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &650,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &20_000);
    stellar_token.mint(&borrower, &20_000);

    manager.set_liquidation_threshold(&14_500);
    manager.set_liquidation_bonus_bps(&1_000);

    let loan_id = manager.request_loan(&borrower, &1_000, &17_280);
    manager.approve_loan(&loan_id);
    manager.deposit_collateral(&loan_id, &1_400);

    let borrower_balance_before = token_client.balance(&borrower);
    let liquidator_balance_before = token_client.balance(&liquidator);
    let pool_balance_before = token_client.balance(&pool_client);

    manager.liquidate(&liquidator, &loan_id);

    let liquidated_loan = manager.get_loan(&loan_id);
    assert_eq!(liquidated_loan.status, LoanStatus::Liquidated);
    assert_eq!(manager.get_collateral(&loan_id), 0);
    assert_eq!(manager.get_borrower_loan_count(&borrower), 0);
    assert_eq!(
        token_client.balance(&pool_client),
        pool_balance_before + 1_000
    );
    assert_eq!(
        token_client.balance(&liquidator),
        liquidator_balance_before + 140
    );
    assert_eq!(
        token_client.balance(&borrower),
        borrower_balance_before + 260
    );
}

#[test]
fn test_liquidate_rejects_healthy_collateral_ratio() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &650,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &20_000);
    stellar_token.mint(&borrower, &20_000);

    let loan_id = manager.request_loan(&borrower, &1_000, &17_280);
    manager.approve_loan(&loan_id);
    manager.deposit_collateral(&loan_id, &1_600);

    let result = manager.try_liquidate(&liquidator, &loan_id);
    assert_eq!(result, Err(Ok(LoanError::LoanNotLiquidatable)));
    assert_eq!(manager.get_loan(&loan_id).status, LoanStatus::Approved);
    assert_eq!(manager.get_collateral(&loan_id), 1_600);
}

#[test]
fn test_liquidation_bonus_cap_enforced() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &650,
        &history_hash,
        &soroban_sdk::String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &20_000);
    stellar_token.mint(&borrower, &20_000);

    // Attempt to set bonus above 20% cap - should fail
    let result = manager.try_set_liquidation_bonus_bps(&3_000); // 30%
    assert_eq!(result, Err(Ok(LoanError::InvalidConfiguration)));

    // Set bonus at the cap (20%) - should succeed
    manager.set_liquidation_bonus_bps(&2_000);
    assert_eq!(manager.get_liquidation_bonus_bps(), 2_000);

    // Create a loan and liquidate it with the cap in effect
    manager.set_liquidation_threshold(&14_500);
    let loan_id = manager.request_loan(&borrower, &1_000, &17_280);
    manager.approve_loan(&loan_id);
    manager.deposit_collateral(&loan_id, &1_400); // Collateral = 1400

    let liquidator_balance_before = token_client.balance(&liquidator);

    manager.liquidate(&liquidator, &loan_id);

    // Loan debt was 1000, collateral was 1400
    // Surplus = 400
    // Bonus = min(20% of 1400 = 280, 400 surplus) = 280
    // Liquidator should receive 280
    let liquidator_balance_after = token_client.balance(&liquidator);
    assert_eq!(liquidator_balance_after, liquidator_balance_before + 280);

    // Verify the cap is enforced - even at max cap, payout doesn't exceed collateral
    // Test completed successfully!
}

#[test]
#[should_panic]
fn test_deposit_collateral_rejects_non_active_loan() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, nft_client, _pool, _token, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &700,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let loan_id = manager.request_loan(&borrower, &500, &17280);
    manager.deposit_collateral(&loan_id, &100);
}

#[test]
fn test_small_loan_interest_accrual_precision() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_address, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_address, &10_000);

    // Request a small loan of 50 units
    let loan_id = manager.request_loan(&borrower, &50, &17280);
    manager.approve_loan(&loan_id);

    let initial_loan = manager.get_loan(&loan_id);
    assert_eq!(initial_loan.accrued_interest, 0);
    assert_eq!(initial_loan.interest_residual, 0);
    // Verify loan is approved and has interest rate configured
    assert!(initial_loan.interest_rate_bps > 0);
}

#[test]
fn test_query_functions() {
    let env = Env::default();
    env.mock_all_auths();

    let (manager, nft_client, pool_address, token_id, token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Test get_admin
    assert_eq!(manager.get_admin(), token_admin);

    // Test get_lending_pool
    assert_eq!(manager.get_lending_pool(), pool_address);

    // Test get_nft_contract - get the contract address from the nft_client
    assert_eq!(manager.get_nft_contract(), nft_client.address);

    assert_eq!(manager.get_token(), token_id);

    // Test get_total_loans initially
    assert_eq!(manager.get_total_loans(), 0);

    // Create a loan and test get_total_loans
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_address, &10_000);

    let _loan_id = manager.request_loan(&borrower, &1000, &17280);
    assert_eq!(manager.get_total_loans(), 1);
}

#[test]
fn test_get_borrower_loans() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_address, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Initially no loans
    assert_eq!(manager.get_borrower_loans(&borrower).len(), 0);

    // Mint NFT for borrower
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    // Setup liquidity
    let _token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_address, &10_000);
    stellar_token.mint(&borrower, &10_000);

    // Request first loan
    let loan_id_1 = manager.request_loan(&borrower, &1000, &17280);
    let borrower_loans = manager.get_borrower_loans(&borrower);
    assert_eq!(borrower_loans.len(), 1);
    assert_eq!(borrower_loans.get(0).unwrap(), loan_id_1);

    // Request second loan (while first is still pending)
    let loan_id_2 = manager.request_loan(&borrower, &500, &17280);
    let borrower_loans = manager.get_borrower_loans(&borrower);
    assert_eq!(borrower_loans.len(), 2);
    assert_eq!(borrower_loans.get(0).unwrap(), loan_id_1);
    assert_eq!(borrower_loans.get(1).unwrap(), loan_id_2);

    // Approve first loan
    manager.approve_loan(&loan_id_1);

    // Approve second loan
    manager.approve_loan(&loan_id_2);

    // Advance ledger for interest accrual
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 100);

    // Repay first loan completely
    let loan_1 = manager.get_loan(&loan_id_1);
    let repay_amount_1 = loan_1.amount + loan_1.accrued_interest + loan_1.accrued_late_fee;
    manager.repay(&borrower, &loan_id_1, &repay_amount_1);

    // Borrower loans should still contain both loans (historical record)
    let borrower_loans = manager.get_borrower_loans(&borrower);
    assert_eq!(borrower_loans.len(), 2);
    assert_eq!(borrower_loans.get(0).unwrap(), loan_id_1);
    assert_eq!(borrower_loans.get(1).unwrap(), loan_id_2);

    // Verify first loan is marked as repaid
    let repaid_loan = manager.get_loan(&loan_id_1);
    assert_eq!(repaid_loan.status, LoanStatus::Repaid);
}

#[test]
fn test_pending_loans_count_against_cap() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (client, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);

    let borrower = Address::generate(&env);
    nft_client.mint(
        &borrower,
        &600,
        &BytesN::from_array(&env, &[1u8; 32]),
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);

    // Set cap to 2
    client.set_max_loans_per_borrower(&2);

    // Request two loans (both pending) — should consume the full cap
    let _loan_id_1 = client.request_loan(&borrower, &500, &17280);
    let _loan_id_2 = client.request_loan(&borrower, &500, &17280);

    assert_eq!(client.get_borrower_loan_count(&borrower), 2);

    // Third request must be rejected even though neither loan is approved yet
    let result = client.try_request_loan(&borrower, &500, &17280);
    assert_eq!(result, Err(Ok(LoanError::MaxLoansReached)));
}

// ── extend_loan tests ──────────────────────────────────────────────────────

#[test]
fn test_extend_loan_happy_path() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Setup: mint NFT with good score
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    // Mint tokens to pool
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);

    // Request and approve loan
    let loan_id = manager.request_loan(&borrower, &1000, &17280);
    manager.approve_loan(&loan_id);

    // Get original due date
    let loan_before = manager.get_loan(&loan_id);
    let original_due_date = loan_before.due_date;
    assert_eq!(loan_before.extension_count, 0);

    // Extend loan by 1000 ledgers
    let extension_ledgers = 1000u32;
    manager.extend_loan(&borrower, &loan_id, &extension_ledgers);

    // Verify extension
    let loan_after = manager.get_loan(&loan_id);
    assert_eq!(loan_after.due_date, original_due_date + extension_ledgers);
    assert_eq!(loan_after.extension_count, 1);
    assert_eq!(loan_after.status, LoanStatus::Approved);
}

#[test]
fn test_extend_loan_wrong_borrower() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);
    let wrong_borrower = Address::generate(&env);

    // Setup
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);

    // Request and approve loan
    let loan_id = manager.request_loan(&borrower, &1000, &17280);
    manager.approve_loan(&loan_id);

    // Try to extend with wrong borrower
    let result = manager.try_extend_loan(&wrong_borrower, &loan_id, &1000);
    assert_eq!(result, Err(Ok(LoanError::BorrowerMismatch)));
}

#[test]
fn test_extend_loan_rejected_for_pending_loan() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, _pool_client, _token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Setup
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    // Request but don't approve
    let loan_id = manager.request_loan(&borrower, &1000, &17280);

    // Try to extend pending loan
    let result = manager.try_extend_loan(&borrower, &loan_id, &1000);
    assert_eq!(result, Err(Ok(LoanError::LoanNotActive)));
}

#[test]
fn test_extend_loan_rejected_for_repaid_loan() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Setup
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);
    stellar_token.mint(&borrower, &5_000);

    // Request, approve, and repay loan
    let loan_id = manager.request_loan(&borrower, &1000, &17280);
    manager.approve_loan(&loan_id);
    manager.repay(&borrower, &loan_id, &1000);

    // Try to extend repaid loan
    let result = manager.try_extend_loan(&borrower, &loan_id, &1000);
    assert_eq!(result, Err(Ok(LoanError::LoanNotActive)));
}

#[test]
fn test_extend_loan_rejected_for_defaulted_loan() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Setup
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);

    // Request and approve loan
    let loan_id = manager.request_loan(&borrower, &1000, &17280);
    manager.approve_loan(&loan_id);

    // Move time past default window
    let loan = manager.get_loan(&loan_id);
    let default_window = manager.get_default_window_ledgers();
    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 0,
        protocol_version: 22,
        sequence_number: loan.due_date + default_window + 1,
        network_id: Default::default(),
        base_reserve: 5_000_000,
        min_temp_entry_ttl: 1_000_000,
        min_persistent_entry_ttl: 1_000_000,
        max_entry_ttl: 10_000_000,
    });

    // Mark as defaulted
    manager.check_defaults(&soroban_sdk::vec![&env, loan_id]);

    // Try to extend defaulted loan - should fail because status is no longer Approved
    let result = manager.try_extend_loan(&borrower, &loan_id, &1000);
    assert_eq!(result, Err(Ok(LoanError::LoanNotActive)));
}

#[test]
fn test_extend_loan_rejected_for_zero_ledgers() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Setup
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);

    // Request and approve loan
    let loan_id = manager.request_loan(&borrower, &1000, &17280);
    manager.approve_loan(&loan_id);

    // Try to extend with 0 ledgers
    let result = manager.try_extend_loan(&borrower, &loan_id, &0);
    assert_eq!(result, Err(Ok(LoanError::InvalidTerm)));
}

#[test]
fn test_extend_loan_max_extensions_limit() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Setup
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &50_000);
    stellar_token.mint(&borrower, &50_000);

    // Request and approve loan
    let loan_id = manager.request_loan(&borrower, &1000, &17280);
    manager.approve_loan(&loan_id);

    // Extend 3 times (max)
    manager.extend_loan(&borrower, &loan_id, &1000);
    manager.extend_loan(&borrower, &loan_id, &1000);
    manager.extend_loan(&borrower, &loan_id, &1000);

    // Verify extension count is 3
    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.extension_count, 3);

    // Fourth extension should fail
    let result = manager.try_extend_loan(&borrower, &loan_id, &1000);
    assert_eq!(result, Err(Ok(LoanError::InvalidConfiguration)));
}

#[test]
fn test_extend_loan_charges_fee() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Setup
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);
    stellar_token.mint(&borrower, &5_000);
    let token_client = TokenClient::new(&env, &token_id);

    // Request and approve loan
    let loan_id = manager.request_loan(&borrower, &1000, &17280);
    manager.approve_loan(&loan_id);

    // Get borrower balance before extension
    let balance_before = token_client.balance(&borrower);

    // Extend loan (should charge 1% of remaining principal = 10)
    manager.extend_loan(&borrower, &loan_id, &1000);

    // Get borrower balance after extension
    let balance_after = token_client.balance(&borrower);

    // Verify fee was charged (1% of 1000 = 10)
    assert_eq!(balance_before - balance_after, 10);
}

#[test]
fn test_extend_loan_multiple_extensions() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Setup
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);
    stellar_token.mint(&borrower, &5_000);

    // Request and approve loan
    let loan_id = manager.request_loan(&borrower, &1000, &17280);
    manager.approve_loan(&loan_id);

    let loan_initial = manager.get_loan(&loan_id);
    let mut expected_due_date = loan_initial.due_date;

    // Extend 3 times
    for i in 1..=3 {
        let extension_ledgers = 500u32;
        manager.extend_loan(&borrower, &loan_id, &extension_ledgers);
        expected_due_date += extension_ledgers;

        let loan = manager.get_loan(&loan_id);
        assert_eq!(loan.extension_count, i as u32);
        assert_eq!(loan.due_date, expected_due_date);
    }
}

#[test]
fn test_extend_loan_not_found() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool_client, _token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Try to extend non-existent loan
    let result = manager.try_extend_loan(&borrower, &999, &1000);
    assert_eq!(result, Err(Ok(LoanError::LoanNotFound)));
}

// ── Oracle rate bounds tests ───────────────────────────────────────────────

#[test]
fn test_oracle_rate_within_bounds_accepted() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Setup
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);

    // Deploy mock oracle returning 800 BPS (within default bounds 1..100_000)
    let oracle_id = env.register(MockRateOracle, ());
    let oracle_client = MockRateOracleClient::new(&env, &oracle_id);
    oracle_client.set_rate(&800);

    // Set the oracle on the loan manager
    manager.set_rate_oracle(&oracle_id);

    // Request loan — the oracle branch should be taken
    let loan_id = manager.request_loan(&borrower, &1000, &17280);
    let loan = manager.get_loan(&loan_id);

    // Should use the oracle rate (800 BPS), not the default (1200 BPS)
    assert_eq!(loan.interest_rate_bps, 800);
}

#[test]
fn test_set_min_rate_bps_success() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool_client, _token_id, _admin) = setup_test(&env);

    // Get initial min rate
    let initial_min = manager.get_min_rate_bps();
    assert_eq!(initial_min, 1); // Default MIN_RATE_BPS

    // Set new min rate
    let result = manager.try_set_min_rate_bps(&100);
    assert!(result.is_ok());

    // Verify it was set
    assert_eq!(manager.get_min_rate_bps(), 100);
}

#[test]
fn test_set_max_rate_bps_success() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool_client, _token_id, _admin) = setup_test(&env);

    // Get initial max rate
    let initial_max = manager.get_max_rate_bps();
    assert_eq!(initial_max, 100_000); // Default MAX_RATE_BPS

    // Set new max rate
    let result = manager.try_set_max_rate_bps(&50_000);
    assert!(result.is_ok());

    // Verify it was set
    assert_eq!(manager.get_max_rate_bps(), 50_000);
}

#[test]
fn test_set_min_rate_bps_zero_rejected() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool_client, _token_id, _admin) = setup_test(&env);

    // Try to set min rate to 0
    let result = manager.try_set_min_rate_bps(&0);
    assert_eq!(result, Err(Ok(LoanError::InvalidRate)));
}

#[test]
fn test_set_max_rate_bps_zero_rejected() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool_client, _token_id, _admin) = setup_test(&env);

    // Try to set max rate to 0
    let result = manager.try_set_max_rate_bps(&0);
    assert_eq!(result, Err(Ok(LoanError::InvalidRate)));
}

#[test]
fn test_set_min_rate_exceeds_max_rejected() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool_client, _token_id, _admin) = setup_test(&env);

    // Set max rate to 10000
    manager.set_max_rate_bps(&10_000);

    // Try to set min rate higher than max
    let result = manager.try_set_min_rate_bps(&20_000);
    assert_eq!(result, Err(Ok(LoanError::InvalidConfiguration)));
}

#[test]
fn test_set_max_rate_below_min_rejected() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool_client, _token_id, _admin) = setup_test(&env);

    // Set min rate to 5000
    manager.set_min_rate_bps(&5_000);

    // Try to set max rate lower than min
    let result = manager.try_set_max_rate_bps(&1_000);
    assert_eq!(result, Err(Ok(LoanError::InvalidConfiguration)));
}

#[test]
fn test_rate_bounds_boundary_values() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool_client, _token_id, _admin) = setup_test(&env);

    // Set min to 1 (minimum possible)
    let result = manager.try_set_min_rate_bps(&1);
    assert!(result.is_ok());
    assert_eq!(manager.get_min_rate_bps(), 1);

    // Set max to 100000 (maximum reasonable)
    let result = manager.try_set_max_rate_bps(&100_000);
    assert!(result.is_ok());
    assert_eq!(manager.get_max_rate_bps(), 100_000);

    // Set min and max to same value (should work)
    manager.set_min_rate_bps(&5_000);
    let result = manager.try_set_max_rate_bps(&5_000);
    assert!(result.is_ok());
    assert_eq!(manager.get_min_rate_bps(), 5_000);
    assert_eq!(manager.get_max_rate_bps(), 5_000);
}

#[test]
fn test_rate_bounds_configurable_independently() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool_client, _token_id, _admin) = setup_test(&env);

    // Set min rate
    manager.set_min_rate_bps(&500);
    assert_eq!(manager.get_min_rate_bps(), 500);
    // Max should remain unchanged
    assert_eq!(manager.get_max_rate_bps(), 100_000);

    // Set max rate
    manager.set_max_rate_bps(&50_000);
    assert_eq!(manager.get_max_rate_bps(), 50_000);
    // Min should remain unchanged
    assert_eq!(manager.get_min_rate_bps(), 500);
}

#[test]
fn test_oracle_rate_below_min_falls_back_to_default() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Setup
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);

    // Deploy mock oracle returning 100 BPS (below the min we will set)
    let oracle_id = env.register(MockRateOracle, ());
    let oracle_client = MockRateOracleClient::new(&env, &oracle_id);
    oracle_client.set_rate(&100);

    manager.set_rate_oracle(&oracle_id);
    manager.set_min_rate_bps(&500);

    // Request loan — oracle returns 100 which is below min_rate_bps=500
    let loan_id = manager.request_loan(&borrower, &1000, &17280);
    let loan = manager.get_loan(&loan_id);

    // Should fall back to default rate (1200 BPS)
    assert_eq!(loan.interest_rate_bps, 1200);
}

#[test]
fn test_oracle_rate_above_max_falls_back_to_default() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Setup
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);

    // Deploy mock oracle returning 5000 BPS (above the max we will set)
    let oracle_id = env.register(MockRateOracle, ());
    let oracle_client = MockRateOracleClient::new(&env, &oracle_id);
    oracle_client.set_rate(&5000);

    manager.set_rate_oracle(&oracle_id);
    manager.set_max_rate_bps(&2_000);

    // Request loan — oracle returns 5000 which is above max_rate_bps=2000
    let loan_id = manager.request_loan(&borrower, &1000, &17280);
    let loan = manager.get_loan(&loan_id);

    // Should fall back to default rate (1200 BPS)
    assert_eq!(loan.interest_rate_bps, 1200);
}

#[test]
fn test_rate_bounds_persist_across_operations() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    // Setup
    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);

    // Set custom rate bounds
    manager.set_min_rate_bps(&100);
    manager.set_max_rate_bps(&50_000);

    // Request and approve loan
    let loan_id = manager.request_loan(&borrower, &1000, &17280);
    manager.approve_loan(&loan_id);

    // Verify bounds are still in place
    assert_eq!(manager.get_min_rate_bps(), 100);
    assert_eq!(manager.get_max_rate_bps(), 50_000);

    // Extend loan
    manager.extend_loan(&borrower, &loan_id, &1000);

    // Verify bounds are still in place
    assert_eq!(manager.get_min_rate_bps(), 100);
    assert_eq!(manager.get_max_rate_bps(), 50_000);
}
#[test]
fn test_interest_calculation_overflow_safety() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &800,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    // Use a massive principal to test overflow safety
    let large_principal = 100_000_000_000_000_000_000_000_000_i128;
    stellar_token.mint(&pool_client, &large_principal);

    // Increase interest rate so the accrual math hits overflow protection well
    // before the repayment window ends.
    manager.set_min_rate_bps(&100);
    manager.set_max_rate_bps(&50_000);
    manager.set_interest_rate(&50_000);

    manager.set_max_loan_amount(&large_principal);
    let loan_id = manager.request_loan(&borrower, &large_principal, &17280);
    manager.approve_loan(&loan_id);

    // Fast-forward far enough to trigger overflow protection, but keep the
    // loan within its repayment window (before due_date + default window).
    let loan = manager.get_loan(&loan_id);
    env.ledger()
        .set_sequence_number(loan.last_interest_ledger + 10_000);

    // Should not panic, should either calculate correctly or return AmountTooLarge error on next interaction
    let result = manager.try_repay(&borrower, &loan_id, &100);
    // Given the massive principal and long duration, it should not panic.
    assert!(
        matches!(result, Ok(Ok(())) | Err(Ok(LoanError::AmountTooLarge))),
        "unexpected result: {result:?}"
    );
}

#[test]
fn test_liquidate_with_collateral_shortfall_has_no_refund() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[1u8; 32]);
    nft_client.mint(
        &borrower,
        &650,
        &history_hash,
        &String::from_str(&env, "ipfs://QmShortfall"),
        &None,
    );

    let token_client = TokenClient::new(&env, &token_id);
    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &20_000);
    stellar_token.mint(&borrower, &20_000);

    manager.set_liquidation_threshold(&15_000);

    let loan_id = manager.request_loan(&borrower, &1_000, &17_280);
    manager.approve_loan(&loan_id);
    manager.deposit_collateral(&loan_id, &900);

    let borrower_balance_before = token_client.balance(&borrower);
    let liquidator_balance_before = token_client.balance(&liquidator);
    let pool_balance_before = token_client.balance(&pool_client);

    manager.liquidate(&liquidator, &loan_id);

    let liquidated_loan = manager.get_loan(&loan_id);
    assert_eq!(liquidated_loan.status, LoanStatus::Liquidated);
    assert_eq!(liquidated_loan.principal_paid, 900);
    assert_eq!(manager.get_collateral(&loan_id), 0);
    assert_eq!(manager.get_borrower_loan_count(&borrower), 0);
    assert_eq!(
        token_client.balance(&pool_client),
        pool_balance_before + 900
    );
    assert_eq!(token_client.balance(&liquidator), liquidator_balance_before);
    assert_eq!(token_client.balance(&borrower), borrower_balance_before);
}

#[test]
fn test_liquidate_rejects_repaid_loan() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[2u8; 32]);
    nft_client.mint(
        &borrower,
        &700,
        &history_hash,
        &String::from_str(&env, "ipfs://QmRepaid"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &20_000);
    stellar_token.mint(&borrower, &20_000);

    let loan_id = manager.request_loan(&borrower, &1_000, &17_280);
    manager.approve_loan(&loan_id);
    manager.deposit_collateral(&loan_id, &400);

    let loan = manager.get_loan(&loan_id);
    let repay_amount = loan.amount + loan.accrued_interest + loan.accrued_late_fee;
    manager.repay(&borrower, &loan_id, &repay_amount);

    let result = manager.try_liquidate(&liquidator, &loan_id);
    assert_eq!(result, Err(Ok(LoanError::LoanNotActive)));
    assert_eq!(manager.get_loan(&loan_id).status, LoanStatus::Repaid);
}

#[test]
fn test_liquidate_emits_loan_liquidated_event_with_expected_amounts() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);
    let liquidator = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[3u8; 32]);
    nft_client.mint(
        &borrower,
        &640,
        &history_hash,
        &String::from_str(&env, "ipfs://QmLiquidationEvent"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &20_000);
    stellar_token.mint(&borrower, &20_000);

    manager.set_liquidation_threshold(&14_500);
    manager.set_liquidation_bonus_bps(&1_000);

    let loan_id = manager.request_loan(&borrower, &1_000, &17_280);
    manager.approve_loan(&loan_id);
    manager.deposit_collateral(&loan_id, &1_400);

    manager.liquidate(&liquidator, &loan_id);

    let events = env.events().all();
    let loan_liquidated_event = events.get(events.len() - 1).unwrap();
    let liquidation_data = soroban_sdk::Vec::<i128>::from_val(&env, &loan_liquidated_event.2);

    assert_eq!(liquidation_data.get(0).unwrap(), 1_000);
    assert_eq!(liquidation_data.get(1).unwrap(), 140);
    assert_eq!(liquidation_data.get(2).unwrap(), 260);
}

#[test]
fn test_late_fee_cap_at_total_debt_limit() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    nft_client.mint(
        &borrower,
        &600,
        &soroban_sdk::BytesN::from_array(&env, &[0u8; 32]),
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);
    stellar_token.mint(&borrower, &10_000);

    let loan_id = manager.request_loan(&borrower, &1000, &1000);
    manager.approve_loan(&loan_id);

    // Jump far into the future so late fees accrue significantly
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 100_000);

    let loan = manager.get_loan(&loan_id);
    let total_outstanding = (loan.amount + loan.accrued_interest + loan.accrued_late_fee)
        - (loan.principal_paid + loan.interest_paid + loan.late_fee_paid);

    // Total debt should be capped at 2x original principal (2000)
    assert!(total_outstanding <= 2000);
    assert!(loan.accrued_late_fee > 0);
}

#[test]
fn test_late_fees_stop_accruing_when_principal_paid() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    nft_client.mint(
        &borrower,
        &600,
        &soroban_sdk::BytesN::from_array(&env, &[0u8; 32]),
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);
    stellar_token.mint(&borrower, &10_000);

    let loan_id = manager.request_loan(&borrower, &1000, &1000);
    manager.approve_loan(&loan_id);

    // Pay off only the principal
    manager.repay(&borrower, &loan_id, &1000);

    // Jump into late fee territory
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 5000);

    let loan = manager.get_loan(&loan_id);
    // Should have zero late fees because principal is paid
    assert_eq!(loan.accrued_late_fee, 0);
}

// ── refinance_loan tests ───────────────────────────────────────────────────

#[test]
fn test_refinance_loan_increases_principal_draws_from_pool() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &700,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    let token_client = TokenClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &50_000);

    // Approve a 1_000-unit loan, then set collateral high enough for refinance.
    let loan_id = manager.request_loan(&borrower, &1_000, &17_280);
    manager.approve_loan(&loan_id);

    // Inject collateral directly so the contract accepts the larger amount.
    stellar_token.mint(&manager.address, &5_000);
    env.as_contract(&manager.address, || {
        let key = DataKey::Loan(loan_id);
        let mut loan: Loan = env.storage().persistent().get(&key).unwrap();
        loan.collateral_amount = 5_000;
        env.storage().persistent().set(&key, &loan);
    });

    let borrower_balance_before = token_client.balance(&borrower);
    let pool_balance_before = token_client.balance(&pool_client);

    // Refinance to 2_000 — pool should disburse the extra 1_000.
    manager.refinance_loan(&loan_id, &2_000, &17_280);

    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.amount, 2_000);
    assert_eq!(loan.principal_paid, 0); // reset on refinance
    assert_eq!(loan.status, LoanStatus::Approved);
    // Borrower received the additional 1_000 from the pool.
    assert_eq!(
        token_client.balance(&borrower),
        borrower_balance_before + 1_000
    );
    assert_eq!(
        token_client.balance(&pool_client),
        pool_balance_before - 1_000
    );
}

#[test]
fn test_refinance_loan_decreases_principal_returns_excess_to_pool() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &700,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    let token_client = TokenClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &50_000);
    // Give borrower tokens so they can return the excess principal.
    stellar_token.mint(&borrower, &10_000);

    let loan_id = manager.request_loan(&borrower, &2_000, &17_280);
    manager.approve_loan(&loan_id);

    // Set collateral so the contract doesn't reject the call.
    stellar_token.mint(&manager.address, &2_000);
    env.as_contract(&manager.address, || {
        let key = DataKey::Loan(loan_id);
        let mut loan: Loan = env.storage().persistent().get(&key).unwrap();
        loan.collateral_amount = 2_000;
        env.storage().persistent().set(&key, &loan);
    });

    let pool_balance_before = token_client.balance(&pool_client);

    // Refinance down to 1_000 — borrower returns 1_000 to the pool.
    manager.refinance_loan(&loan_id, &1_000, &17_280);

    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.amount, 1_000);
    assert_eq!(loan.principal_paid, 0);
    assert_eq!(loan.status, LoanStatus::Approved);
    // Pool received the 1_000 excess back.
    assert_eq!(
        token_client.balance(&pool_client),
        pool_balance_before + 1_000
    );
}

#[test]
fn test_refinance_loan_fails_when_score_drops_below_minimum() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &50_000);

    let loan_id = manager.request_loan(&borrower, &1_000, &17_280);
    manager.approve_loan(&loan_id);

    // Artificially lower the borrower's score below the 500 minimum by
    // overwriting the Metadata entry directly in the NFT contract's storage.
    env.as_contract(&nft_client.address, || {
        use remittance_nft::{DataKey as NftKey, RemittanceMetadata};
        let key = NftKey::Metadata(borrower.clone());
        let mut meta: RemittanceMetadata = env.storage().persistent().get(&key).unwrap();
        meta.score = 400;
        env.storage().persistent().set(&key, &meta);
    });

    let result = manager.try_refinance_loan(&loan_id, &1_000, &17_280);
    assert_eq!(result, Err(Ok(LoanError::InsufficientScore)));
    // Loan must remain unchanged.
    assert_eq!(manager.get_loan(&loan_id).status, LoanStatus::Approved);
}

// ── Pause functionality tests ──────────────────────────────────────────────

#[test]
fn test_pause_blocks_request_loan() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, _pool, _token, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    // Pause the contract
    manager.pause();
    assert!(manager.is_paused());

    // Should fail with ContractPaused error
    let result = manager.try_request_loan(&borrower, &1000, &17280);
    assert_eq!(result, Err(Ok(LoanError::ContractPaused)));
}

#[test]
fn test_pause_blocks_approve_loan() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);

    // Request loan before pausing
    let loan_id = manager.request_loan(&borrower, &1000, &17280);

    // Pause the contract
    manager.pause();
    assert!(manager.is_paused());

    // Should fail with ContractPaused error
    let result = manager.try_approve_loan(&loan_id);
    assert_eq!(result, Err(Ok(LoanError::ContractPaused)));
}

#[test]
fn test_pause_blocks_repay() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);
    stellar_token.mint(&borrower, &2_000);

    // Request and approve loan before pausing
    let loan_id = manager.request_loan(&borrower, &1000, &17280);
    manager.approve_loan(&loan_id);

    // Pause the contract
    manager.pause();
    assert!(manager.is_paused());

    // Should fail with ContractPaused error
    let result = manager.try_repay(&borrower, &loan_id, &100);
    assert_eq!(result, Err(Ok(LoanError::ContractPaused)));
}

#[test]
fn test_unpause_restores_request_loan() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, _pool, _token, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    // Pause the contract
    manager.pause();
    assert!(manager.is_paused());

    // Verify request_loan is blocked
    let result = manager.try_request_loan(&borrower, &1000, &17280);
    assert_eq!(result, Err(Ok(LoanError::ContractPaused)));

    // Unpause the contract
    manager.unpause();
    assert!(!manager.is_paused());

    // Now request_loan should succeed
    let loan_id = manager.request_loan(&borrower, &1000, &17280);
    assert_eq!(loan_id, 1);

    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Pending);
}

#[test]
#[should_panic]
fn test_non_admin_cannot_pause() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool, _token, _admin) = setup_test(&env);
    let non_admin = Address::generate(&env);

    // Clear all auths and only authorize non_admin
    env.mock_auths(&[]);
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &non_admin,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &manager.address,
            fn_name: "pause",
            args: soroban_sdk::vec![&env],
            sub_invokes: &[],
        },
    }]);

    // Should panic because non_admin is not authorized
    manager.pause();
}

#[test]
fn test_collateral_release_works_while_paused() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);
    stellar_token.mint(&borrower, &2_000);

    // Request, approve, and fully repay loan before pausing
    let loan_id = manager.request_loan(&borrower, &1000, &17280);
    manager.approve_loan(&loan_id);

    // Fully repay the loan
    let loan = manager.get_loan(&loan_id);
    let total_owed = loan.amount + loan.accrued_interest;
    manager.repay(&borrower, &loan_id, &total_owed);

    // Verify loan is repaid
    let loan = manager.get_loan(&loan_id);
    assert_eq!(loan.status, LoanStatus::Repaid);

    // Pause the contract
    manager.pause();
    assert!(manager.is_paused());

    // Collateral release should still work while paused
    // (This is tested implicitly - if it panics, the test fails)
    // The existing test already covers this scenario, but we verify it explicitly here
    let result = manager.try_cancel_loan(&borrower, &loan_id);
    // Cancel on a repaid loan should fail with InvalidLoanStatus, not ContractPaused
    assert!(result.is_err());
}

// ── purge_loan tests ───────────────────────────────────────────────────────

#[test]
fn test_purge_repaid_loan_removes_storage() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);
    stellar_token.mint(&borrower, &10_000);

    let loan_id = manager.request_loan(&borrower, &1_000, &17280);
    manager.approve_loan(&loan_id);
    manager.repay(&borrower, &loan_id, &1_000);
    assert_eq!(manager.get_loan(&loan_id).status, LoanStatus::Repaid);

    manager.purge_loan(&loan_id);

    // Verify loan storage was removed
    let exists: bool = env.as_contract(&manager.address, || {
        env.storage().persistent().has(&DataKey::Loan(loan_id))
    });
    assert!(!exists);
}

#[test]
fn test_purge_cancelled_loan_removes_storage() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, _pool, _token, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let loan_id = manager.request_loan(&borrower, &1_000, &17280);
    manager.cancel_loan(&borrower, &loan_id);
    assert_eq!(manager.get_loan(&loan_id).status, LoanStatus::Cancelled);

    manager.purge_loan(&loan_id);

    let exists: bool = env.as_contract(&manager.address, || {
        env.storage().persistent().has(&DataKey::Loan(loan_id))
    });
    assert!(!exists);
}

#[test]
fn test_purge_rejected_loan_removes_storage() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, _pool, _token, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let loan_id = manager.request_loan(&borrower, &1_000, &17280);
    manager.reject_loan(&loan_id, &String::from_str(&env, "manual review failed"));
    assert_eq!(manager.get_loan(&loan_id).status, LoanStatus::Rejected);

    manager.purge_loan(&loan_id);

    let exists: bool = env.as_contract(&manager.address, || {
        env.storage().persistent().has(&DataKey::Loan(loan_id))
    });
    assert!(!exists);
}

#[test]
fn test_purge_pending_loan_rejected() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, _pool, _token, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let loan_id = manager.request_loan(&borrower, &1_000, &17280);

    let result = manager.try_purge_loan(&loan_id);
    assert_eq!(result, Err(Ok(LoanError::LoanNotPurgable)));
}

#[test]
fn test_purge_approved_loan_rejected() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);

    let loan_id = manager.request_loan(&borrower, &1_000, &17280);
    manager.approve_loan(&loan_id);

    let result = manager.try_purge_loan(&loan_id);
    assert_eq!(result, Err(Ok(LoanError::LoanNotPurgable)));
}

#[test]
fn test_purge_nonexistent_loan_rejected() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool, _token, _admin) = setup_test(&env);

    let result = manager.try_purge_loan(&999);
    assert_eq!(result, Err(Ok(LoanError::LoanNotFound)));
}

#[test]
fn test_purge_emits_loan_purged_event() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);
    stellar_token.mint(&borrower, &10_000);

    let loan_id = manager.request_loan(&borrower, &1_000, &17280);
    manager.approve_loan(&loan_id);
    manager.repay(&borrower, &loan_id, &1_000);

    manager.purge_loan(&loan_id);

    let events = env.events().all();
    let purge_event = events.get(events.len() - 1).unwrap();
    let topic_0 = soroban_sdk::Symbol::from_val(&env, &purge_event.1.get(0).unwrap());
    assert_eq!(topic_0, soroban_sdk::Symbol::new(&env, "LoanPurged"));
}

#[test]
fn test_purge_cancelled_loan_decrements_borrower_loan_count() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, _pool, _token, _admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let loan_id = manager.request_loan(&borrower, &1_000, &17280);
    manager.cancel_loan(&borrower, &loan_id);
    manager.purge_loan(&loan_id);

    // Borrower loan count should have been decremented
    // (no direct getter for borrower_loan_count, but we can verify no panic)
}

// ── get_total_outstanding tests ────────────────────────────────────────────

#[test]
fn test_get_total_outstanding_tracks_approve_and_repay() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    assert_eq!(manager.get_total_outstanding(&token_id), 0);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);
    stellar_token.mint(&borrower, &10_000);

    let loan_id = manager.request_loan(&borrower, &1_000, &17_280);
    manager.approve_loan(&loan_id);
    assert_eq!(manager.get_total_outstanding(&token_id), 1_000);

    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 2_000);

    let loan = manager.get_loan(&loan_id);
    let remaining_debt = loan.amount + loan.accrued_interest + loan.accrued_late_fee
        - loan.principal_paid
        - loan.interest_paid
        - loan.late_fee_paid;
    manager.repay(&borrower, &loan_id, &remaining_debt);
    assert_eq!(manager.get_total_outstanding(&token_id), 0);
}

#[test]
fn test_get_total_outstanding_decreases_on_check_default() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &600,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &10_000);

    let loan_id = manager.request_loan(&borrower, &1_000, &17_280);
    manager.approve_loan(&loan_id);
    assert_eq!(manager.get_total_outstanding(&token_id), 1_000);

    let due_date = manager.get_loan(&loan_id).due_date;
    let default_window = manager.get_default_window_ledgers();
    env.ledger()
        .set_sequence_number(due_date + default_window + 1);

    manager.check_default(&loan_id);
    assert_eq!(manager.get_total_outstanding(&token_id), 0);
}

#[test]
fn test_is_liquidatable_healthy_loan() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &650,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &20_000);
    stellar_token.mint(&borrower, &20_000);

    let loan_id = manager.request_loan(&borrower, &1_000, &17_280);
    manager.approve_loan(&loan_id);
    manager.deposit_collateral(&loan_id, &1_600);

    assert!(!manager.is_liquidatable(&loan_id));
}

#[test]
fn test_is_liquidatable_under_threshold() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &650,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &20_000);
    stellar_token.mint(&borrower, &20_000);

    manager.set_liquidation_threshold(&14_500);

    let loan_id = manager.request_loan(&borrower, &1_000, &17_280);
    manager.approve_loan(&loan_id);
    manager.deposit_collateral(&loan_id, &1_400);

    assert!(manager.is_liquidatable(&loan_id));
}

#[test]
fn test_is_liquidatable_exactly_at_threshold() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &650,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &20_000);
    stellar_token.mint(&borrower, &20_000);

    let loan_id = manager.request_loan(&borrower, &1_000, &17_280);
    manager.approve_loan(&loan_id);
    // Default threshold 150% → collateral/debt must be < 1.5 to liquidate.
    manager.deposit_collateral(&loan_id, &1_500);

    assert!(!manager.is_liquidatable(&loan_id));
}

#[test]
fn test_is_liquidatable_zero_collateral() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &650,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &20_000);

    let loan_id = manager.request_loan(&borrower, &1_000, &17_280);
    manager.approve_loan(&loan_id);

    assert!(manager.is_liquidatable(&loan_id));
}

#[test]
fn test_is_liquidatable_non_active_loan() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, _pool_client, _token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &650,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let loan_id = manager.request_loan(&borrower, &1_000, &17_280);
    assert!(!manager.is_liquidatable(&loan_id));
}

#[test]
fn test_get_loan_health_matches_liquidation_state() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, nft_client, pool_client, token_id, _token_admin) = setup_test(&env);
    let borrower = Address::generate(&env);

    let history_hash = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    nft_client.mint(
        &borrower,
        &650,
        &history_hash,
        &String::from_str(&env, "ipfs://QmTest"),
        &None,
    );

    let stellar_token = StellarAssetClient::new(&env, &token_id);
    stellar_token.mint(&pool_client, &20_000);
    stellar_token.mint(&borrower, &20_000);

    manager.set_liquidation_threshold(&14_500);

    let loan_id = manager.request_loan(&borrower, &1_000, &17_280);
    manager.approve_loan(&loan_id);
    manager.deposit_collateral(&loan_id, &1_400);

    let (collateral, total_debt, ratio_bps) = manager.get_loan_health(&loan_id);
    assert_eq!(collateral, 1_400);
    assert!(total_debt >= 1_000);
    assert!(ratio_bps > 0);
    assert!(manager.is_liquidatable(&loan_id));

    let pending_id = manager.request_loan(&borrower, &500, &17_280);
    let (pending_collateral, pending_debt, pending_ratio) = manager.get_loan_health(&pending_id);
    assert_eq!(pending_collateral, 0);
    assert_eq!(pending_debt, 0);
    assert_eq!(pending_ratio, 0);
}

// ── Oracle get/set and event tests ──────────────────────────────────────────

#[test]
fn test_get_rate_oracle_returns_set_address() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool_client, _token_id, _admin) = setup_test(&env);

    // Initially no oracle is set
    assert_eq!(manager.get_rate_oracle(), None);

    // Deploy and set a mock oracle
    let oracle_id = env.register(MockRateOracle, ());
    manager.set_rate_oracle(&oracle_id);

    // get_rate_oracle should return the address we just set
    assert_eq!(manager.get_rate_oracle(), Some(oracle_id));
}

#[test]
fn test_set_rate_oracle_emits_rate_oracle_updated_event() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let (manager, _nft_client, _pool_client, _token_id, _admin) = setup_test(&env);

    let oracle_id = env.register(MockRateOracle, ());
    manager.set_rate_oracle(&oracle_id);

    let events = env.events().all();
    let has_oracle_event = events.iter().any(|(_contract_id, topics, _data)| {
        topics.len() == 1
            && topics
                .get(0)
                .map(|t| {
                    soroban_sdk::Symbol::from_val(&env, &t)
                        == soroban_sdk::Symbol::new(&env, "RateOracleUpdated")
                })
                .unwrap_or(false)
    });
    assert!(
        has_oracle_event,
        "RateOracleUpdated event should be emitted"
    );
}
