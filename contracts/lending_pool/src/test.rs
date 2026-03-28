use crate::{LendingPool, LendingPoolClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{Address, BytesN, Env};

fn create_token_contract<'a>(
    env: &Env,
    admin: &Address,
) -> (Address, StellarAssetClient<'a>, TokenClient<'a>) {
    let contract_id = env.register_stellar_asset_contract_v2(admin.clone());
    let stellar_asset_client = StellarAssetClient::new(env, &contract_id.address());
    let token_client = TokenClient::new(env, &contract_id.address());
    (contract_id.address(), stellar_asset_client, token_client)
}

fn create_upgrade_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[7u8; 32])
}

#[test]
fn test_version_is_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);

    pool_client.initialize(&admin);
    assert_eq!(pool_client.version(), 2);
}

#[test]
#[should_panic]
fn test_upgrade_requires_admin_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);

    env.mock_all_auths();
    pool_client.initialize(&admin);

    env.mock_auths(&[]);
    pool_client.upgrade(&create_upgrade_hash(&env));
}

// ── Deposit ───────────────────────────────────────────────────────────────────

#[test]
fn test_deposit_flow() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5000);
    assert_eq!(token_client.balance(&provider), 5000);

    pool_client.deposit(&provider, &token_id, &3000);

    assert_eq!(token_client.balance(&provider), 2000);
    assert_eq!(token_client.balance(&pool_id), 3000);

    // First deposit: 1:1 share minting.
    assert_eq!(pool_client.get_shares(&provider, &token_id), 3000);
    // No yield yet — asset value equals shares.
    assert_eq!(pool_client.get_deposit(&provider, &token_id), 3000);
    assert_eq!(pool_client.get_total_shares(&token_id), 3000);
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

    env.mock_auths(&[]); // Enforce require_auth() natively.
    pool_client.deposit(&provider, &token_id, &1000);
}

// ── Withdraw ──────────────────────────────────────────────────────────────────

#[test]
fn test_withdraw_flow() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5000);

    pool_client.deposit(&provider, &token_id, &3000);
    assert_eq!(token_client.balance(&provider), 2000);
    assert_eq!(token_client.balance(&pool_id), 3000);
    assert_eq!(pool_client.get_shares(&provider, &token_id), 3000);

    // Redeem 1000 shares → 1000 assets (no yield yet, 1:1 rate).
    pool_client.withdraw(&provider, &token_id, &1000);

    assert_eq!(token_client.balance(&provider), 3000);
    assert_eq!(token_client.balance(&pool_id), 2000);
    assert_eq!(pool_client.get_shares(&provider, &token_id), 2000);
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
    pool_client.deposit(&provider, &token_id, &1000); // receives 1000 shares

    // Attempt to redeem more shares than held.
    pool_client.withdraw(&provider, &token_id, &2000);
}

// ── Deposit / Withdraw invariants ─────────────────────────────────────────────

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

    for &(deposit_amount, withdraw_shares) in scenarios {
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

        // Without yield, shares == asset amounts (1:1 initial rate).
        let shares = pool_client.get_shares(&provider, &token_id);
        assert_eq!(shares, deposit_amount, "1:1 initial share allocation");
        assert!(shares >= 0);

        pool_client.withdraw(&provider, &token_id, &withdraw_shares);

        let final_shares = pool_client.get_shares(&provider, &token_id);
        assert!(final_shares >= 0);
        assert_eq!(
            final_shares,
            deposit_amount - withdraw_shares,
            "remaining shares after withdrawal"
        );
    }
}

// ── Yield distribution (share-based) ─────────────────────────────────────────

#[test]
fn test_share_price_increases_when_interest_arrives() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &1_000);
    pool_client.deposit(&provider, &token_id, &1_000); // 1000 shares

    // Simulate loan repayment with 100 tokens of interest.
    stellar_asset_client.mint(&pool_id, &100);

    // Provider still holds 1000 shares; pool now has 1100 tokens.
    assert_eq!(pool_client.get_shares(&provider, &token_id), 1_000);
    assert_eq!(pool_client.get_deposit(&provider, &token_id), 1_100);
}

#[test]
fn test_withdraw_returns_principal_plus_interest() {
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

    // 200 tokens of interest flow back to the pool.
    stellar_asset_client.mint(&pool_id, &200);

    // Redeem all 1000 shares → should receive 1200 tokens (principal + yield).
    pool_client.withdraw(&provider, &token_id, &1_000);

    assert_eq!(token_client.balance(&provider), 1_200);
    assert_eq!(token_client.balance(&pool_id), 0);
}

#[test]
fn test_pro_rata_yield_distribution_on_withdrawal() {
    // provider_a holds 60 % of shares, provider_b holds 40 %.
    // 100 tokens of interest arrive.  Each should receive their proportional
    // share of the total (principal + interest) on withdrawal.
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

    // provider_a: 600 shares (pool=600, total_shares=600).
    pool_client.deposit(&provider_a, &token_id, &600);
    // provider_b: shares = 400 * 600 / 600 = 400 (pool=1000, total_shares=1000).
    pool_client.deposit(&provider_b, &token_id, &400);

    // 100 tokens of interest paid into pool.
    stellar_asset_client.mint(&pool_id, &100);
    // Pool: 1100 | Shares: 1000

    // provider_a redeems 600 shares: 600 * 1100 / 1000 = 660 tokens.
    pool_client.withdraw(&provider_a, &token_id, &600);

    // provider_b redeems 400 shares: 400 * 440 / 400 = 440 tokens.
    pool_client.withdraw(&provider_b, &token_id, &400);

    // provider_a: 400 (remaining wallet) + 660 (redeemed) = 1060.
    assert_eq!(token_client.balance(&provider_a), 1_060);
    // provider_b: 600 (remaining wallet) + 440 (redeemed) = 1040.
    assert_eq!(token_client.balance(&provider_b), 1_040);
    assert_eq!(token_client.balance(&pool_id), 0);
}

#[test]
fn test_subsequent_depositor_does_not_dilute_existing_holders() {
    // provider_a deposits, yield arrives, then provider_b deposits.
    // provider_b must NOT benefit from the pre-existing yield.
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
    stellar_asset_client.mint(&provider_b, &1_100);

    // provider_a deposits 1000 → 1000 shares.
    pool_client.deposit(&provider_a, &token_id, &1_000);

    // 100 tokens of yield arrive.  Pool = 1100, shares = 1000.
    stellar_asset_client.mint(&pool_id, &100);

    // provider_b deposits 1100 at the new exchange rate (1.1):
    //   shares_minted = 1100 * 1000 / 1100 = 1000 shares.
    pool_client.deposit(&provider_b, &token_id, &1_100);
    // Pool: 2200 | Shares: 2000

    assert_eq!(pool_client.get_shares(&provider_a, &token_id), 1_000);
    assert_eq!(pool_client.get_shares(&provider_b, &token_id), 1_000);

    // Each share is worth 2200 / 2000 = 1.1.
    // provider_a redeems → 1100 (1000 principal + 100 yield).
    pool_client.withdraw(&provider_a, &token_id, &1_000);
    assert_eq!(token_client.balance(&provider_a), 1_100);

    // provider_b redeems → 1100 (exactly their 1100 principal, no extra).
    pool_client.withdraw(&provider_b, &token_id, &1_000);
    assert_eq!(token_client.balance(&provider_b), 1_100);

    assert_eq!(token_client.balance(&pool_id), 0);
}

#[test]
fn test_full_loan_cycle_with_interest() {
    // End-to-end: deposit → loan out → repaid with interest → withdraw more.
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);

    let provider = Address::generate(&env);
    let borrower = Address::generate(&env);
    stellar_asset_client.mint(&provider, &1_000);
    pool_client.deposit(&provider, &token_id, &1_000);

    // 800 tokens leave the pool as a loan.
    token_client.transfer(&pool_id, &borrower, &800);
    assert_eq!(token_client.balance(&pool_id), 200);

    // Borrower repays 800 principal + 80 interest = 880.
    stellar_asset_client.mint(&borrower, &80);
    token_client.transfer(&borrower, &pool_id, &880);
    assert_eq!(token_client.balance(&pool_id), 1_080);

    // Provider redeems all 1000 shares → 1080 (principal + interest).
    pool_client.withdraw(&provider, &token_id, &1_000);
    assert_eq!(token_client.balance(&provider), 1_080);
    assert_eq!(token_client.balance(&pool_id), 0);
}

// ── Admin transfer ────────────────────────────────────────────────────────────

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

// ── MaxPoolSize ───────────────────────────────────────────────────────────────

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
    assert_eq!(pool_client.get_shares(&provider, &token_id), 5_000);
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

    // Redeem 1000 shares → 1000 assets (no yield), total_deposits reduces by 1000.
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

    // Pool is full; redeem 1000 shares to free cap space.
    pool_client.withdraw(&provider, &token_id, &1_000);

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

// ── PoolStats ─────────────────────────────────────────────────────────────────

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

    // Initial state.
    let stats = pool_client.get_pool_stats(&token_id);
    assert_eq!(stats.total_deposits, 0);
    assert_eq!(stats.total_shares, 0);
    assert_eq!(stats.depositor_count, 0);
    assert_eq!(stats.utilization_bps, 0);

    // After first deposit.
    pool_client.deposit(&provider1, &token_id, &2000);
    let stats = pool_client.get_pool_stats(&token_id);
    assert_eq!(stats.total_deposits, 2000);
    assert_eq!(stats.total_shares, 2000);
    assert_eq!(stats.depositor_count, 1);
    assert_eq!(stats.utilization_bps, 0);

    // After second deposit.
    pool_client.deposit(&provider2, &token_id, &2000);
    let stats = pool_client.get_pool_stats(&token_id);
    assert_eq!(stats.total_deposits, 4000);
    assert_eq!(stats.total_shares, 4000);
    assert_eq!(stats.depositor_count, 2);

    // Simulate a loan (1000 tokens leave pool).
    let token_client = TokenClient::new(&env, &token_id);
    token_client.transfer(&pool_id, &borrower, &1000);
    let stats = pool_client.get_pool_stats(&token_id);
    assert_eq!(stats.total_deposits, 4000);
    assert_eq!(stats.pool_token_balance, 3000);
    assert_eq!(stats.utilization_bps, 2500); // 1000 / 4000 = 25 %

    // Return borrowed tokens before withdrawals so providers get full value.
    token_client.transfer(&borrower, &pool_id, &1000);

    // provider1 redeems 2000 shares → 2000 assets (no yield in this test).
    pool_client.withdraw(&provider1, &token_id, &2000);
    let stats = pool_client.get_pool_stats(&token_id);
    assert_eq!(stats.total_deposits, 2000);
    assert_eq!(stats.total_shares, 2000);
    assert_eq!(stats.depositor_count, 1);

    // provider2 redeems 2000 shares → 2000 assets.
    pool_client.withdraw(&provider2, &token_id, &2000);
    let stats = pool_client.get_pool_stats(&token_id);
    assert_eq!(stats.total_deposits, 0);
    assert_eq!(stats.total_shares, 0);
    assert_eq!(stats.depositor_count, 0);
}
