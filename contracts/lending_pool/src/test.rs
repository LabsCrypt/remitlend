use crate::{LendingPool, LendingPoolClient};
use soroban_sdk::testutils::Address as _;
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

    // 3. Initialize LendingPool with Token
    pool_client.initialize(&token_id, &token_admin);

    // 4. Setup provider with some initial tokens
    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5000);
    assert_eq!(token_client.balance(&provider), 5000);

    // 5. Test Deposting 3000 tokens
    pool_client.deposit(&provider, &3000);

    // 6. Verify Balances
    assert_eq!(token_client.balance(&provider), 2000);
    assert_eq!(token_client.balance(&pool_id), 3000);

    // 7. Verify internal ledger states
    assert_eq!(pool_client.get_deposit(&provider), 3000);
}

#[test]
#[should_panic(expected = "deposit amount must be positive")]
fn test_negative_deposit_panic() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, _stellar_asset_client, _token_client) =
        create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_id, &token_admin);

    let provider = Address::generate(&env);
    pool_client.deposit(&provider, &0);
}

#[test]
#[should_panic]
fn test_deposit_unauthorized() {
    let env = Env::default();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_id, &token_admin);

    let provider = Address::generate(&env);

    env.mock_all_auths();
    stellar_asset_client.mint(&provider, &5000);

    env.mock_auths(&[]); // Reset mocked auths enforcing require_auth() natively

    // Should fail missing native authorizations
    pool_client.deposit(&provider, &1000);
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
    pool_client.initialize(&token_id, &token_admin);

    // 3. Setup provider with 5000 tokens
    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5000);

    // 4. Deposit 3000 tokens
    pool_client.deposit(&provider, &3000);
    assert_eq!(token_client.balance(&provider), 2000);
    assert_eq!(token_client.balance(&pool_id), 3000);
    assert_eq!(pool_client.get_deposit(&provider), 3000);

    // 5. Withdraw 1000 tokens
    pool_client.withdraw(&provider, &1000);

    // 6. Verify Balances
    assert_eq!(token_client.balance(&provider), 3000);
    assert_eq!(token_client.balance(&pool_id), 2000);
    assert_eq!(pool_client.get_deposit(&provider), 2000);
}

#[test]
#[should_panic(expected = "withdraw amount must be positive")]
fn test_negative_withdraw_panic() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, _stellar_asset_client, _token_client) =
        create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_id, &token_admin);

    let provider = Address::generate(&env);
    pool_client.withdraw(&provider, &0);
}

#[test]
#[should_panic(expected = "insufficient balance")]
fn test_insufficient_balance_withdraw_panic() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_id, &token_admin);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5000);
    pool_client.deposit(&provider, &1000);

    // Attempt to withdraw more than deposited
    pool_client.withdraw(&provider, &2000);
}

#[test]
#[should_panic(expected = "insufficient pool liquidity")]
fn test_insufficient_pool_liquidity_withdraw_panic() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_id, &token_admin);

    let provider = Address::generate(&env);
    let borrower = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5000);
    pool_client.deposit(&provider, &1000);

    // Simulate liquidity usage outside depositor accounting (e.g. active loans).
    token_client.transfer(&pool_id, &borrower, &800);
    assert_eq!(token_client.balance(&pool_id), 200);
    assert_eq!(pool_client.get_deposit(&provider), 1000);

    pool_client.withdraw(&provider, &500);
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
        pool_client.initialize(&token_id, &token_admin);

        let provider = Address::generate(&env);
        stellar_asset_client.mint(&provider, &deposit_amount);
        pool_client.deposit(&provider, &deposit_amount);

        let deposit_balance = pool_client.get_deposit(&provider);
        assert!(
            deposit_balance >= 0,
            "Deposit balance should never be negative"
        );
        assert_eq!(
            deposit_balance, deposit_amount,
            "Deposit balance should match deposit amount"
        );

        pool_client.withdraw(&provider, &withdraw_amount);

        let final_balance = pool_client.get_deposit(&provider);
        assert!(final_balance >= 0, "Final balance should never be negative");
        assert_eq!(
            final_balance,
            deposit_amount - withdraw_amount,
            "Final balance should equal deposit minus withdrawal"
        );
    }
}

// ── MaxPoolSize tests ────────────────────────────────────────────────────────

#[test]
fn test_set_and_get_max_pool_size() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, _stellar_asset_client, _token_client) =
        create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_id, &token_admin);

    // Default: no cap
    assert_eq!(pool_client.get_max_pool_size(), 0);

    pool_client.set_max_pool_size(&10_000);
    assert_eq!(pool_client.get_max_pool_size(), 10_000);
}

#[test]
fn test_deposit_within_cap_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_id, &token_admin);
    pool_client.set_max_pool_size(&5_000);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5_000);

    pool_client.deposit(&provider, &5_000);
    assert_eq!(pool_client.get_deposit(&provider), 5_000);
    assert_eq!(pool_client.get_total_deposits(), 5_000);
}

#[test]
#[should_panic(expected = "deposit exceeds max pool size")]
fn test_deposit_exceeds_cap_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_id, &token_admin);
    pool_client.set_max_pool_size(&1_000);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &2_000);

    // Should panic — 1001 > cap of 1000
    pool_client.deposit(&provider, &1_001);
}

#[test]
fn test_withdraw_reduces_total_deposits() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_id, &token_admin);
    pool_client.set_max_pool_size(&5_000);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &3_000);
    pool_client.deposit(&provider, &3_000);
    assert_eq!(pool_client.get_total_deposits(), 3_000);

    pool_client.withdraw(&provider, &1_000);
    assert_eq!(pool_client.get_total_deposits(), 2_000);
}

#[test]
fn test_deposit_after_withdraw_frees_cap_space() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_id, &token_admin);
    pool_client.set_max_pool_size(&3_000);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &3_000);
    pool_client.deposit(&provider, &3_000);

    // Pool is full; withdraw 1000 to free space
    pool_client.withdraw(&provider, &1_000);

    // Re-deposit 1000 — should succeed now
    stellar_asset_client.mint(&provider, &1_000);
    pool_client.deposit(&provider, &1_000);
    assert_eq!(pool_client.get_total_deposits(), 3_000);
}

#[test]
fn test_no_cap_allows_unlimited_deposits() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_id, &token_admin);
    // No set_max_pool_size call — cap stays 0 (unlimited)

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &1_000_000);
    pool_client.deposit(&provider, &1_000_000);
    assert_eq!(pool_client.get_total_deposits(), 1_000_000);
}

#[test]
#[should_panic(expected = "max pool size must be non-negative")]
fn test_set_negative_max_pool_size_panics() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, _stellar_asset_client, _token_client) =
        create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_id, &token_admin);

    pool_client.set_max_pool_size(&-1);
}

#[test]
fn test_pool_stats() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_id, &token_admin);

    let provider1 = Address::generate(&env);
    let provider2 = Address::generate(&env);

    stellar_asset_client.mint(&provider1, &1000);
    stellar_asset_client.mint(&provider2, &2000);

    // Initial stats
    let stats = pool_client.get_pool_stats();
    assert_eq!(stats.total_deposits, 0);
    assert_eq!(stats.depositor_count, 0);
    assert_eq!(stats.utilization_bps, 0);

    // First deposit
    pool_client.deposit(&provider1, &1000);
    let stats = pool_client.get_pool_stats();
    assert_eq!(stats.total_deposits, 1000);
    assert_eq!(stats.depositor_count, 1);
    assert_eq!(stats.pool_token_balance, 1000);
    assert_eq!(stats.utilization_bps, 0);

    // Second deposit (new provider)
    pool_client.deposit(&provider2, &2000);
    let stats = pool_client.get_pool_stats();
    assert_eq!(stats.total_deposits, 3000);
    assert_eq!(stats.depositor_count, 2);
    assert_eq!(stats.pool_token_balance, 3000);

    // Third deposit (existing provider)
    stellar_asset_client.mint(&provider1, &500);
    pool_client.deposit(&provider1, &500);
    let stats = pool_client.get_pool_stats();
    assert_eq!(stats.total_deposits, 3500);
    assert_eq!(stats.depositor_count, 2);

    // Simulate utilization (lend out 1750 tokens - 50% utilization)
    let borrower = Address::generate(&env);
    token_client.transfer(&pool_id, &borrower, &1750);
    let stats = pool_client.get_pool_stats();
    assert_eq!(stats.total_deposits, 3500);
    assert_eq!(stats.pool_token_balance, 1750);
    assert_eq!(stats.utilization_bps, 5000); // 50%

    // Withdraw 1000 for provider 1 (should succeed as 1000 <= 1750)
    pool_client.withdraw(&provider1, &1000);
    let stats = pool_client.get_pool_stats();
    assert_eq!(stats.total_deposits, 2500);
    assert_eq!(stats.depositor_count, 2);

    // Return the borrowed tokens to test full withdrawal
    token_client.transfer(&borrower, &pool_id, &1750);

    // Withdraw all for provider 2
    pool_client.withdraw(&provider2, &2000);
    let stats = pool_client.get_pool_stats();
    assert_eq!(stats.total_deposits, 500);
    assert_eq!(stats.depositor_count, 1);
}
