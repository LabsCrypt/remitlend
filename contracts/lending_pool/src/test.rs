use crate::{LendingPool, LendingPoolClient};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{Address, Env};

fn create_token_contract<'a>(
    env: &Env,
    admin: &Address,
) -> (Address, StellarAssetClient<'a>, TokenClient<'a>) {
    let contract_id = env.register_stellar_asset_contract_v2(admin.clone());
    let stellar_asset_client = StellarAssetClient::new(env, &contract_id.address());
    let token_client = TokenClient::new(env, &contract_id.address());
    (contract_id.address(), stellar_asset_client, token_client)
}

#[test]
fn test_deposit_flow() {
    let env = Env::default();
    env.mock_all_auths();

    // 1. Setup mock asset
    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    // 2. Setup LendingPool
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);

    // 3. Initialize LendingPool (no token arg — multi-token)
    pool_client.initialize(&token_admin);

    // 4. Setup provider with some initial tokens
    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5000);
    assert_eq!(token_client.balance(&provider), 5000);

    // 5. Test depositing 3000 tokens
    pool_client.deposit(&provider, &token_id, &3000);

    // 6. Verify Balances
    assert_eq!(token_client.balance(&provider), 2000);
    assert_eq!(token_client.balance(&pool_id), 3000);

    // 7. Verify internal ledger states
    assert_eq!(pool_client.get_deposit(&provider, &token_id), 3000);
}

#[test]
#[should_panic]
fn test_negative_deposit_panic() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, _stellar_asset_client, _token_client) =
        create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);

    let provider = Address::generate(&env);
    pool_client.deposit(&provider, &token_id, &0);
}

#[test]
#[should_panic]
fn test_deposit_unauthorized() {
    let env = Env::default();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);

    env.mock_all_auths();
    pool_client.initialize(&token_admin);
    stellar_asset_client.mint(&Address::generate(&env), &5000);

    let provider = Address::generate(&env);
    env.mock_all_auths();
    stellar_asset_client.mint(&provider, &5000);

    env.mock_auths(&[]); // Reset mocked auths — require_auth() enforced natively

    // Should fail missing native authorizations
    pool_client.deposit(&provider, &token_id, &1000);
}

#[test]
fn test_withdraw_flow() {
    let env = Env::default();
    env.mock_all_auths();

    // 1. Setup mock asset
    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    // 2. Setup LendingPool
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);

    // 3. Setup provider with 5000 tokens
    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5000);

    // 4. Deposit 3000 tokens
    pool_client.deposit(&provider, &token_id, &3000);
    assert_eq!(token_client.balance(&provider), 2000);
    assert_eq!(token_client.balance(&pool_id), 3000);
    assert_eq!(pool_client.get_deposit(&provider, &token_id), 3000);

    // 5. Withdraw 1000 tokens
    pool_client.withdraw(&provider, &token_id, &1000);

    // 6. Verify Balances
    assert_eq!(token_client.balance(&provider), 3000);
    assert_eq!(token_client.balance(&pool_id), 2000);
    assert_eq!(pool_client.get_deposit(&provider, &token_id), 2000);
}

#[test]
#[should_panic]
fn test_negative_withdraw_panic() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, _stellar_asset_client, _token_client) =
        create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);

    let provider = Address::generate(&env);
    pool_client.withdraw(&provider, &token_id, &0);
}

#[test]
#[should_panic]
fn test_insufficient_balance_withdraw_panic() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5000);
    pool_client.deposit(&provider, &token_id, &1000);

    // Attempt to withdraw more than deposited
    pool_client.withdraw(&provider, &token_id, &2000);
}

#[test]
#[should_panic]
fn test_insufficient_pool_liquidity_withdraw_panic() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);

    let provider = Address::generate(&env);
    let borrower = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5000);
    pool_client.deposit(&provider, &token_id, &1000);

    // Simulate liquidity usage outside depositor accounting (e.g. active loans).
    token_client.transfer(&pool_id, &borrower, &800);
    assert_eq!(token_client.balance(&pool_id), 200);
    assert_eq!(pool_client.get_deposit(&provider, &token_id), 1000);

    pool_client.withdraw(&provider, &token_id, &500);
}

#[test]
fn test_deposit_withdraw_invariants() {
    let scenarios: &[(i128, i128)] = &[
        (1, 1),
        (100, 1),
        (100, 50),
        (100, 100),
        (3_000, 1_000),
        (10_000, 9_999),
    ];

    for &(deposit_amount, withdraw_amount) in scenarios {
        let env = Env::default();
        env.mock_all_auths();

        let token_admin = Address::generate(&env);
        let (token_id, stellar_asset_client, _token_client) =
            create_token_contract(&env, &token_admin);

        let pool_id = env.register(LendingPool, ());
        let pool_client = LendingPoolClient::new(&env, &pool_id);
        pool_client.initialize(&token_admin);

        let provider = Address::generate(&env);
        stellar_asset_client.mint(&provider, &deposit_amount);
        pool_client.deposit(&provider, &token_id, &deposit_amount);

        let deposit_balance = pool_client.get_deposit(&provider, &token_id);
        assert!(
            deposit_balance >= 0,
            "Deposit balance should never be negative"
        );
        assert_eq!(
            deposit_balance, deposit_amount,
            "Deposit balance should match deposit amount"
        );

        pool_client.withdraw(&provider, &token_id, &withdraw_amount);

        let final_balance = pool_client.get_deposit(&provider, &token_id);
        assert!(final_balance >= 0, "Final balance should never be negative");
        assert_eq!(
            final_balance,
            deposit_amount - withdraw_amount,
            "Final balance should equal deposit minus withdrawal"
        );
    }
}

#[test]
fn test_claim_yield_distributes_pro_rata_interest() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);

    let provider_a = Address::generate(&env);
    let provider_b = Address::generate(&env);
    stellar_asset_client.mint(&provider_a, &1_000);
    stellar_asset_client.mint(&provider_b, &1_000);

    pool_client.deposit(&provider_a, &token_id, &600);
    pool_client.deposit(&provider_b, &token_id, &400);

    // Simulate realized interest returning to the pool.
    stellar_asset_client.mint(&pool_id, &100);
    assert_eq!(token_client.balance(&pool_id), 1_100);

    pool_client.claim_yield(&provider_a, &token_id);
    pool_client.claim_yield(&provider_b, &token_id);

    assert_eq!(token_client.balance(&provider_a), 460);
    assert_eq!(token_client.balance(&provider_b), 640);
    assert_eq!(token_client.balance(&pool_id), 1_000);
}

#[test]
fn test_claim_yield_with_no_realized_yield_is_noop() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &1_000);
    pool_client.deposit(&provider, &token_id, &1_000);

    let provider_balance_before = token_client.balance(&provider);
    let pool_balance_before = token_client.balance(&pool_id);

    // Should not panic when no yield is available.
    pool_client.claim_yield(&provider, &token_id);

    assert_eq!(token_client.balance(&provider), provider_balance_before);
    assert_eq!(token_client.balance(&pool_id), pool_balance_before);
    assert_eq!(pool_client.get_deposit(&provider, &token_id), 1_000);
}

#[test]
fn test_second_claim_without_new_yield_is_noop() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &1_000);
    pool_client.deposit(&provider, &token_id, &1_000);

    // Realize yield and claim it once.
    stellar_asset_client.mint(&pool_id, &100);
    pool_client.claim_yield(&provider, &token_id);
    let balance_after_first_claim = token_client.balance(&provider);

    // No new realized yield; second claim should be a no-op.
    pool_client.claim_yield(&provider, &token_id);
    assert_eq!(token_client.balance(&provider), balance_after_first_claim);
}

#[test]
fn test_admin_transfer_flow() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);

    let new_admin = Address::generate(&env);
    pool_client.propose_admin(&new_admin);
    pool_client.accept_admin();

    assert_eq!(pool_client.get_admin(), new_admin);
}

// MaxPoolSize tests

#[test]
fn test_set_and_get_max_pool_size() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, _stellar_asset_client, _token_client) =
        create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);

    // Default: no cap
    assert_eq!(pool_client.get_max_pool_size(&token_id), 0);

    pool_client.set_max_pool_size(&token_id, &10_000);
    assert_eq!(pool_client.get_max_pool_size(&token_id), 10_000);
}

#[test]
fn test_deposit_within_cap_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);
    pool_client.set_max_pool_size(&token_id, &5_000);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5_000);

    pool_client.deposit(&provider, &token_id, &5_000);
    assert_eq!(pool_client.get_deposit(&provider, &token_id), 5_000);
    assert_eq!(pool_client.get_total_deposits(&token_id), 5_000);
}

#[test]
#[should_panic]
fn test_deposit_exceeds_cap_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);
    pool_client.set_max_pool_size(&token_id, &1_000);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &2_000);

    // Should panic — 1001 > cap of 1000
    pool_client.deposit(&provider, &token_id, &1_001);
}

#[test]
fn test_withdraw_reduces_total_deposits() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);
    pool_client.set_max_pool_size(&token_id, &5_000);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &3_000);
    pool_client.deposit(&provider, &token_id, &3_000);
    assert_eq!(pool_client.get_total_deposits(&token_id), 3_000);

    pool_client.withdraw(&provider, &token_id, &1_000);
    assert_eq!(pool_client.get_total_deposits(&token_id), 2_000);
}

#[test]
fn test_deposit_after_withdraw_frees_cap_space() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);
    pool_client.set_max_pool_size(&token_id, &3_000);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &3_000);
    pool_client.deposit(&provider, &token_id, &3_000);

    // Pool is full; withdraw 1000 to free space
    pool_client.withdraw(&provider, &token_id, &1_000);

    // Re-deposit 1000 — should succeed now
    stellar_asset_client.mint(&provider, &1_000);
    pool_client.deposit(&provider, &token_id, &1_000);
    assert_eq!(pool_client.get_total_deposits(&token_id), 3_000);
}

#[test]
fn test_no_cap_allows_unlimited_deposits() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);
    // No set_max_pool_size call — cap stays 0 (unlimited)

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &1_000_000);
    pool_client.deposit(&provider, &token_id, &1_000_000);
    assert_eq!(pool_client.get_total_deposits(&token_id), 1_000_000);
}

#[test]
#[should_panic]
fn test_set_negative_max_pool_size_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, _stellar_asset_client, _token_client) =
        create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);

    pool_client.set_max_pool_size(&token_id, &-1);
}

#[test]
fn test_pool_stats() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);

    let provider1 = Address::generate(&env);
    let provider2 = Address::generate(&env);
    let borrower = Address::generate(&env);

    stellar_asset_client.mint(&provider1, &5000);
    stellar_asset_client.mint(&provider2, &5000);

    // Initial stats
    let stats = pool_client.get_pool_stats(&token_id);
    assert_eq!(stats.total_deposits, 0);
    assert_eq!(stats.depositor_count, 0);
    assert_eq!(stats.utilization_bps, 0);

    // After first deposit
    pool_client.deposit(&provider1, &token_id, &2000);
    let stats = pool_client.get_pool_stats(&token_id);
    assert_eq!(stats.total_deposits, 2000);
    assert_eq!(stats.depositor_count, 1);
    assert_eq!(stats.utilization_bps, 0);

    // After second deposit
    pool_client.deposit(&provider2, &token_id, &2000);
    let stats = pool_client.get_pool_stats(&token_id);
    assert_eq!(stats.total_deposits, 4000);
    assert_eq!(stats.depositor_count, 2);

    // Simulate borrowing (utilization)
    let token_client = TokenClient::new(&env, &token_id);
    token_client.transfer(&pool_id, &borrower, &1000);
    let stats = pool_client.get_pool_stats(&token_id);
    assert_eq!(stats.total_deposits, 4000);
    assert_eq!(stats.pool_token_balance, 3000);
    assert_eq!(stats.utilization_bps, 2500); // 1000/4000 = 25%

    // Full withdrawal provider 1
    pool_client.withdraw(&provider1, &token_id, &2000);
    let stats = pool_client.get_pool_stats(&token_id);
    assert_eq!(stats.total_deposits, 2000);
    assert_eq!(stats.depositor_count, 1);

    // Return the borrowed tokens to test full withdrawal
    token_client.transfer(&borrower, &pool_id, &1000);

    // Withdraw all for provider 2
    pool_client.withdraw(&provider2, &token_id, &2000);
    let stats = pool_client.get_pool_stats(&token_id);
    assert_eq!(stats.total_deposits, 0);
    assert_eq!(stats.depositor_count, 0);
}

#[test]
fn test_concurrent_deposit_withdraw_same_ledger() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);

    let provider_a = Address::generate(&env);
    let provider_b = Address::generate(&env);
    stellar_asset_client.mint(&provider_a, &2000);
    stellar_asset_client.mint(&provider_b, &2000);

    // Initial sequence
    env.ledger().set_sequence_number(100);

    // All these happen in the same ledger sequence
    pool_client.deposit(&provider_a, &token_id, &1000);

    // Simulate interest being earned (minted to pool)
    stellar_asset_client.mint(&pool_id, &100);

    pool_client.deposit(&provider_b, &token_id, &1000);

    // More interest
    stellar_asset_client.mint(&pool_id, &50);

    pool_client.withdraw(&provider_a, &token_id, &500);

    // Check balances
    // provider_a: 2000 - 1000 + 500 = 1500 (tokens)
    // plus accrued yield.
    // Interest 1: 100 added. Total deposits was 1000.
    // AccYieldPerDeposit becomes 100 * SCALE / 1000.
    // Interest 2: 50 added. Total deposits was 2000.
    // AccYieldPerDeposit becomes (100/1000 + 50/2000) * SCALE.

    assert_eq!(token_client.balance(&provider_a), 1500);
    assert_eq!(token_client.balance(&provider_b), 1000);

    // Claim yield and verify
    pool_client.claim_yield(&provider_a, &token_id);
    pool_client.claim_yield(&provider_b, &token_id);

    // Provider A yield: 100% of Int1 (100) + 50% of Int2 (25) = 125
    // Provider B yield: 0% of Int1 (0) + 50% of Int2 (25) = 25
    // Total yield = 150. Matches mints.

    assert_eq!(token_client.balance(&provider_a), 1625);
    assert_eq!(token_client.balance(&provider_b), 1025);

    assert_eq!(pool_client.get_total_deposits(&token_id), 1500);
}
