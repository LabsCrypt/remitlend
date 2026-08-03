use crate::{events, LendingPool, LendingPoolClient};
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{Address, BytesN, Env, FromVal, IntoVal, TryFromVal};

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
    assert_eq!(pool_client.version(), 3);
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
    pool_client.set_withdrawal_cooldown(&0);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5000);
    assert_eq!(token_client.balance(&provider), 5000);

    pool_client.deposit(&provider, &token_id, &3000, &0);

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
    pool_client.set_withdrawal_cooldown(&0);

    let provider = Address::generate(&env);
    pool_client.deposit(&provider, &token_id, &0, &0);
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
    pool_client.deposit(&provider, &token_id, &1000, &0);
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
    assert_eq!(pool_client.get_withdrawal_cooldown(), 1_440);
    pool_client.set_withdrawal_cooldown(&0);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5000);

    pool_client.deposit(&provider, &token_id, &3000, &0);
    assert_eq!(token_client.balance(&provider), 2000);
    assert_eq!(token_client.balance(&pool_id), 3000);
    assert_eq!(pool_client.get_shares(&provider, &token_id), 3000);

    // Redeem 1000 shares → 1000 assets (no yield yet, 1:1 rate).
    pool_client.withdraw(&provider, &token_id, &1000, &0);

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
    pool_client.set_withdrawal_cooldown(&0);

    let provider = Address::generate(&env);
    pool_client.withdraw(&provider, &token_id, &0, &0);
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
    pool_client.set_withdrawal_cooldown(&0);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5000);
    pool_client.deposit(&provider, &token_id, &1000, &0); // receives 1000 shares

    // Attempt to redeem more shares than held.
    pool_client.withdraw(&provider, &token_id, &2000, &0);
}

#[test]
#[should_panic(expected = "withdrawal_cooldown_active")]
fn test_immediate_withdraw_panics_when_cooldown_active() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5_000);
    pool_client.deposit(&provider, &token_id, &1_000, &0);

    pool_client.withdraw(&provider, &token_id, &1_000, &0);
}

#[test]
fn test_withdraw_succeeds_after_cooldown() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);
    pool_client.set_withdrawal_cooldown(&5);
    assert_eq!(pool_client.get_withdrawal_cooldown(), 5);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5_000);
    pool_client.deposit(&provider, &token_id, &1_000, &0);

    env.ledger().set_sequence_number(5);
    pool_client.withdraw(&provider, &token_id, &1_000, &0);

    assert_eq!(token_client.balance(&provider), 5_000);
    assert_eq!(token_client.balance(&pool_id), 0);
}

#[test]
fn test_set_withdrawal_cooldown_rejects_values_above_maximum() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);

    let result = pool_client.try_set_withdrawal_cooldown(&(17_280 * 30 + 1));
    assert_eq!(result, Err(Ok(crate::PoolError::CooldownTooLong)));
    assert_eq!(pool_client.get_withdrawal_cooldown(), 1_440);
}

// ── Cooldown view functions ───────────────────────────────────────────────────

#[test]
fn test_get_withdrawal_available_at_fresh_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);
    pool_client.set_withdrawal_cooldown(&5);
    assert_eq!(pool_client.get_withdrawal_cooldown(), 5);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5_000);
    env.ledger().set_sequence_number(100);
    pool_client.deposit(&provider, &token_id, &1_000, &0);

    // After fresh deposit at ledger 100, withdrawal available at 100 + 5 = 105.
    assert_eq!(
        pool_client.get_withdrawal_available_at(&provider, &token_id),
        105
    );
    // Remaining: 105 - 101 = 4 ledgers (ledger advanced to 101 after deposit tx).
    assert!(
        pool_client.get_withdraw_cooldown_left(&provider, &token_id) > 0,
        "cooldown should be active immediately after deposit"
    );
}

#[test]
fn test_get_withdrawal_available_at_after_cooldown() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);
    pool_client.set_withdrawal_cooldown(&5);
    assert_eq!(pool_client.get_withdrawal_cooldown(), 5);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5_000);
    env.ledger().set_sequence_number(100);
    pool_client.deposit(&provider, &token_id, &1_000, &0);

    // Advance exactly to the available-at ledger
    env.ledger().set_sequence_number(105);
    // Remaining should be 0 because cooldown has elapsed
    assert_eq!(
        pool_client.get_withdraw_cooldown_left(&provider, &token_id),
        0
    );
    // Available_at still returns the same value
    assert_eq!(
        pool_client.get_withdrawal_available_at(&provider, &token_id),
        105
    );
}

#[test]
fn test_get_withdrawal_available_at_no_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, _stellar_asset_client, _token_client) =
        create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);

    let provider = Address::generate(&env);
    assert_eq!(
        pool_client.get_withdrawal_available_at(&provider, &token_id),
        0
    );
    assert_eq!(
        pool_client.get_withdraw_cooldown_left(&provider, &token_id),
        0
    );
}

#[test]
fn test_get_withdrawal_available_at_cooldown_disabled() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);
    pool_client.set_withdrawal_cooldown(&0);
    assert_eq!(pool_client.get_withdrawal_cooldown(), 0);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5_000);
    env.ledger().set_sequence_number(100);
    pool_client.deposit(&provider, &token_id, &1_000, &0);

    assert_eq!(
        pool_client.get_withdrawal_available_at(&provider, &token_id),
        0
    );
    assert_eq!(
        pool_client.get_withdraw_cooldown_left(&provider, &token_id),
        0
    );
}

#[test]
fn test_emergency_withdraw_bypasses_pause_and_cooldown() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);
    pool_client.set_withdrawal_cooldown(&100);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5_000);
    pool_client.deposit(&provider, &token_id, &1_500, &0);

    pool_client.pause();
    pool_client.emergency_withdraw(&provider, &token_id, &1_500, &0);

    assert_eq!(token_client.balance(&provider), 5_000);
    assert_eq!(token_client.balance(&pool_id), 0);
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
        pool_client.set_withdrawal_cooldown(&0);

        let provider = Address::generate(&env);
        stellar_asset_client.mint(&provider, &deposit_amount);
        pool_client.deposit(&provider, &token_id, &deposit_amount, &0);

        // Without yield, shares == asset amounts (1:1 initial rate).
        let shares = pool_client.get_shares(&provider, &token_id);
        assert_eq!(shares, deposit_amount, "1:1 initial share allocation");
        assert!(shares >= 0);

        pool_client.withdraw(&provider, &token_id, &withdraw_shares, &0);

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
    pool_client.set_withdrawal_cooldown(&0);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &1_000);
    pool_client.deposit(&provider, &token_id, &1_000, &0); // 1000 shares

    // Simulate loan repayment with 100 tokens of interest, realized through
    // the explicit accrual path (a bare transfer to the pool's address is
    // deliberately ignored for pricing — see #1380).
    stellar_asset_client.mint(&token_admin, &100);
    pool_client.distribute_yield(&token_admin, &token_id, &100);

    // Provider still holds 1000 shares; pool now has 1100 tokens tracked.
    // With the virtual-offset formula: 1000 * (1100 + 1000) / (1000 + 1000)
    // = 1050 (rounded down, in the pool's favor).
    assert_eq!(pool_client.get_shares(&provider, &token_id), 1_000);
    assert_eq!(pool_client.get_deposit(&provider, &token_id), 1_050);
}

#[test]
fn test_yield_distributed_event_updates_total_yield_distributed() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_id, _stellar_asset_client, _token_client) = create_token_contract(&env, &admin);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);

    assert_eq!(pool_client.get_total_yield_distributed(&token_id), 0);

    env.as_contract(&pool_id, || {
        events::yield_distributed(&env, token_id.clone(), 100);
    });
    env.as_contract(&pool_id, || {
        events::yield_distributed(&env, token_id.clone(), 50);
    });

    assert_eq!(pool_client.get_total_yield_distributed(&token_id), 150);
    assert_eq!(
        pool_client
            .get_pool_stats(&token_id)
            .total_yield_distributed,
        150
    );
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
    pool_client.set_withdrawal_cooldown(&0);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &1_000);
    pool_client.deposit(&provider, &token_id, &1_000, &0);

    // 200 tokens of interest flow back to the pool through the accrual path.
    stellar_asset_client.mint(&token_admin, &200);
    pool_client.distribute_yield(&token_admin, &token_id, &200);

    // Redeem all 1000 shares. With the virtual-offset formula:
    // 1000 * (1200 + 1000) / (1000 + 1000) = 1100 (rounded down), leaving
    // 100 dust in the pool in the pool's favor.
    pool_client.withdraw(&provider, &token_id, &1_000, &0);

    assert_eq!(token_client.balance(&provider), 1_100);
    assert_eq!(token_client.balance(&pool_id), 100);
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
    pool_client.set_withdrawal_cooldown(&0);

    let provider_a = Address::generate(&env);
    let provider_b = Address::generate(&env);
    stellar_asset_client.mint(&provider_a, &1_000);
    stellar_asset_client.mint(&provider_b, &1_000);

    // provider_a: 600 shares (pool=600, total_shares=600).
    pool_client.deposit(&provider_a, &token_id, &600, &0);
    // provider_b: shares = 400 * (600 + 1000) / (600 + 1000) = 400
    // (pool=1000, total_shares=1000; the virtual offset cancels exactly at
    // a 1:1 price).
    pool_client.deposit(&provider_b, &token_id, &400, &0);

    // 100 tokens of interest paid into pool through the accrual path.
    stellar_asset_client.mint(&token_admin, &100);
    pool_client.distribute_yield(&token_admin, &token_id, &100);
    // Managed assets: 1100 | Shares: 1000

    // provider_a redeems 600 shares:
    // 600 * (1100 + 1000) / (1000 + 1000) = 630 tokens.
    pool_client.withdraw(&provider_a, &token_id, &600, &0);

    // provider_b redeems 400 shares (managed=470, shares=400 after a exits):
    // 400 * (470 + 1000) / (400 + 1000) = 420 tokens.
    pool_client.withdraw(&provider_b, &token_id, &400, &0);

    // provider_a: 400 (remaining wallet) + 630 (redeemed) = 1030.
    assert_eq!(token_client.balance(&provider_a), 1_030);
    // provider_b: 600 (remaining wallet) + 420 (redeemed) = 1020.
    assert_eq!(token_client.balance(&provider_b), 1_020);
    // 50 dust remains in the pool, in the pool's favor (rounding).
    assert_eq!(token_client.balance(&pool_id), 50);
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
    pool_client.set_withdrawal_cooldown(&0);

    let provider_a = Address::generate(&env);
    let provider_b = Address::generate(&env);
    stellar_asset_client.mint(&provider_a, &1_000);
    stellar_asset_client.mint(&provider_b, &1_100);

    // provider_a deposits 1000 → 1000 shares.
    pool_client.deposit(&provider_a, &token_id, &1_000, &0);

    // 100 tokens of yield arrive through the accrual path.
    // Managed assets = 1100, shares = 1000.
    stellar_asset_client.mint(&token_admin, &100);
    pool_client.distribute_yield(&token_admin, &token_id, &100);

    // provider_b deposits 1100 at the new exchange rate:
    //   shares_minted = 1100 * (1000 + 1000) / (1100 + 1000) = 1047
    //   (rounded down — provider_b is *not* credited the pre-existing yield).
    pool_client.deposit(&provider_b, &token_id, &1_100, &0);
    // Managed assets: 2200 | Shares: 2047

    assert_eq!(pool_client.get_shares(&provider_a, &token_id), 1_000);
    assert_eq!(pool_client.get_shares(&provider_b, &token_id), 1_047);

    // provider_a redeems 1000 shares:
    // 1000 * (2200 + 1000) / (2047 + 1000) = 1050.
    pool_client.withdraw(&provider_a, &token_id, &1_000, &0);
    assert_eq!(token_client.balance(&provider_a), 1_050);

    // provider_b redeems all 1047 shares (managed=1150, shares=1047 after a
    // exits): 1047 * (1150 + 1000) / (1047 + 1000) = 1099.
    pool_client.withdraw(&provider_b, &token_id, &1_047, &0);
    assert_eq!(token_client.balance(&provider_b), 1_099);

    // Dust remains in the pool, in the pool's favor (rounding).
    assert_eq!(token_client.balance(&pool_id), 51);
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
    pool_client.set_withdrawal_cooldown(&0);

    let provider = Address::generate(&env);
    let borrower = Address::generate(&env);
    stellar_asset_client.mint(&provider, &1_000);
    pool_client.deposit(&provider, &token_id, &1_000, &0);

    // 800 tokens leave the pool as a loan. Principal is tracked internally
    // via adjust_outstanding, so pricing (share value) is unaffected by the
    // idle-balance drop -- only actual liquidity is (see
    // test_withdrawal_with_utilization for that case).
    token_client.transfer(&pool_id, &borrower, &800);
    pool_client.adjust_outstanding(&token_id, &800);
    assert_eq!(token_client.balance(&pool_id), 200);

    // Borrower repays 800 principal + 80 interest = 880. The principal
    // return is a bare transfer paired with adjust_outstanding; the 80
    // interest is realized through the explicit accrual path (which
    // performs its own transfer) so it -- and only it -- moves the share
    // price. A bare transfer alone would not (#1380).
    stellar_asset_client.mint(&borrower, &80);
    token_client.transfer(&borrower, &pool_id, &800);
    pool_client.adjust_outstanding(&token_id, &-800);
    pool_client.distribute_yield(&borrower, &token_id, &80);
    assert_eq!(token_client.balance(&pool_id), 1_080);

    // Provider redeems all 1000 shares:
    // 1000 * (1080 + 1000) / (1000 + 1000) = 1040 (rounded down).
    pool_client.withdraw(&provider, &token_id, &1_000, &0);
    assert_eq!(token_client.balance(&provider), 1_040);
    assert_eq!(token_client.balance(&pool_id), 40);
}

#[test]
fn test_pool_stats_reflect_funds_allocated_and_returned() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);
    pool_client.set_withdrawal_cooldown(&0);

    let provider = Address::generate(&env);
    let borrower = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5_000);

    pool_client.deposit(&provider, &token_id, &5_000, &0);

    let initial_stats = pool_client.get_pool_stats(&token_id);
    assert_eq!(initial_stats.total_deposits, 5_000);
    assert_eq!(initial_stats.pool_token_balance, 5_000);
    assert_eq!(initial_stats.utilization_bps, 0);

    token_client.transfer(&pool_id, &borrower, &2_000);
    let allocated_stats = pool_client.get_pool_stats(&token_id);
    assert_eq!(allocated_stats.pool_token_balance, 3_000);
    assert_eq!(allocated_stats.total_deposits, 5_000);
    assert_eq!(allocated_stats.utilization_bps, 4_000);

    stellar_asset_client.mint(&borrower, &200);
    token_client.transfer(&borrower, &pool_id, &2_200);

    let returned_stats = pool_client.get_pool_stats(&token_id);
    assert_eq!(returned_stats.pool_token_balance, 5_200);
    assert_eq!(returned_stats.total_deposits, 5_000);
    assert_eq!(returned_stats.utilization_bps, 0);
}

#[test]
fn test_many_depositors_receive_proportional_yield() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);
    pool_client.set_withdrawal_cooldown(&0);

    let depositors = [
        (Address::generate(&env), 1_000_i128),
        (Address::generate(&env), 2_000_i128),
        (Address::generate(&env), 3_000_i128),
    ];

    for (provider, amount) in &depositors {
        stellar_asset_client.mint(provider, amount);
        pool_client.deposit(provider, &token_id, amount, &0);
    }

    stellar_asset_client.mint(&token_admin, &600);
    pool_client.distribute_yield(&token_admin, &token_id, &600);

    for (provider, shares) in &depositors {
        pool_client.withdraw(provider, &token_id, shares, &0);
    }

    // With the virtual-offset formula and sequential redemption (each
    // depositor's payout depends on the managed-assets/shares remaining
    // when they redeem): 1085, 2171, 3258 (each rounded down).
    assert_eq!(token_client.balance(&depositors[0].0), 1_085);
    assert_eq!(token_client.balance(&depositors[1].0), 2_171);
    assert_eq!(token_client.balance(&depositors[2].0), 3_258);
    // 86 dust remains, in the pool's favor (rounding).
    assert_eq!(token_client.balance(&pool_id), 86);
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
    pool_client.set_withdrawal_cooldown(&0);

    let new_admin = Address::generate(&env);
    pool_client.propose_admin(&new_admin);
    pool_client.accept_admin();

    let events = env.events().all();
    let event = events.get(events.len() - 1).unwrap();
    let topic_0 = soroban_sdk::Symbol::from_val(&env, &event.1.get(0).unwrap());
    let topic_1 = soroban_sdk::Symbol::from_val(&env, &event.1.get(1).unwrap());
    let admins = <(Address, Address)>::from_val(&env, &event.2);
    assert_eq!(topic_0, soroban_sdk::Symbol::new(&env, "AdminTransferred"));
    assert_eq!(topic_1, soroban_sdk::Symbol::new(&env, "accept"));
    assert_eq!(admins, (token_admin, new_admin.clone()));
    assert_eq!(pool_client.get_admin(), new_admin);
}

#[test]
fn test_set_admin_updates_admin_immediately() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);

    let new_admin = Address::generate(&env);
    pool_client.set_admin(&new_admin);

    let events = env.events().all();
    let event = events.get(events.len() - 1).unwrap();
    let topic_0 = soroban_sdk::Symbol::from_val(&env, &event.1.get(0).unwrap());
    let topic_1 = soroban_sdk::Symbol::from_val(&env, &event.1.get(1).unwrap());
    let admins = <(Address, Address)>::from_val(&env, &event.2);
    assert_eq!(topic_0, soroban_sdk::Symbol::new(&env, "AdminTransferred"));
    assert_eq!(topic_1, soroban_sdk::Symbol::new(&env, "govern"));
    assert_eq!(admins, (admin, new_admin.clone()));
    assert_eq!(pool_client.get_admin(), new_admin);
}

#[test]
fn test_get_proposed_admin_returns_none_when_no_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);

    assert_eq!(pool_client.get_proposed_admin(), None);
}

#[test]
fn test_get_proposed_admin_returns_proposed_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);

    let new_admin = Address::generate(&env);
    pool_client.propose_admin(&new_admin);

    assert_eq!(pool_client.get_proposed_admin(), Some(new_admin));
}

#[test]
fn test_get_proposed_admin_returns_none_after_accept() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);

    let new_admin = Address::generate(&env);
    pool_client.propose_admin(&new_admin);
    pool_client.accept_admin();

    assert_eq!(pool_client.get_proposed_admin(), None);
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
    pool_client.set_withdrawal_cooldown(&0);

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
    pool_client.set_withdrawal_cooldown(&0);
    pool_client.set_max_pool_size(&token_id, &5_000);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5_000);

    pool_client.deposit(&provider, &token_id, &5_000, &0);
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

    pool_client.deposit(&provider, &token_id, &1_001, &0);
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
    pool_client.set_withdrawal_cooldown(&0);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &3_000);
    pool_client.deposit(&provider, &token_id, &3_000, &0);
    assert_eq!(pool_client.get_total_deposits(&token_id), 3_000);

    // Redeem 1000 shares → 1000 assets (no yield), total_deposits reduces by 1000.
    pool_client.withdraw(&provider, &token_id, &1_000, &0);
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
    pool_client.set_withdrawal_cooldown(&0);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &3_000);
    pool_client.deposit(&provider, &token_id, &3_000, &0);

    // Pool is full; redeem 1000 shares to free cap space.
    pool_client.withdraw(&provider, &token_id, &1_000, &0);

    stellar_asset_client.mint(&provider, &1_000);
    pool_client.deposit(&provider, &token_id, &1_000, &0);
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
    pool_client.set_withdrawal_cooldown(&0);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &1_000_000);
    pool_client.deposit(&provider, &token_id, &1_000_000, &0);
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
    pool_client.set_withdrawal_cooldown(&0);

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
    assert_eq!(stats.total_yield_distributed, 0);
    assert_eq!(stats.utilization_bps, 0);
    assert_eq!(pool_client.get_depositor_count(&token_id), 0);
    assert_eq!(pool_client.get_total_yield_distributed(&token_id), 0);

    // After first deposit.
    pool_client.deposit(&provider1, &token_id, &2000, &0);
    let stats = pool_client.get_pool_stats(&token_id);
    assert_eq!(stats.total_deposits, 2000);
    assert_eq!(stats.total_shares, 2000);
    assert_eq!(stats.depositor_count, 1);
    assert_eq!(stats.total_yield_distributed, 0);
    assert_eq!(stats.utilization_bps, 0);
    assert_eq!(pool_client.get_depositor_count(&token_id), 1);

    // After second deposit.
    pool_client.deposit(&provider2, &token_id, &2000, &0);
    let stats = pool_client.get_pool_stats(&token_id);
    assert_eq!(stats.total_deposits, 4000);
    assert_eq!(stats.total_shares, 4000);
    assert_eq!(stats.depositor_count, 2);
    assert_eq!(stats.total_yield_distributed, 0);
    assert_eq!(pool_client.get_depositor_count(&token_id), 2);

    // Simulate a loan (1000 tokens leave pool).
    let token_client = TokenClient::new(&env, &token_id);
    token_client.transfer(&pool_id, &borrower, &1000);
    let stats = pool_client.get_pool_stats(&token_id);
    assert_eq!(stats.total_deposits, 4000);
    assert_eq!(stats.pool_token_balance, 3000);
    assert_eq!(stats.total_yield_distributed, 0);
    assert_eq!(stats.utilization_bps, 2500); // 1000 / 4000 = 25 %

    // Return borrowed tokens before withdrawals so providers get full value.
    token_client.transfer(&borrower, &pool_id, &1000);

    // provider1 redeems 2000 shares → 2000 assets (no yield in this test).
    pool_client.withdraw(&provider1, &token_id, &2000, &0);
    let stats = pool_client.get_pool_stats(&token_id);
    assert_eq!(stats.total_deposits, 2000);
    assert_eq!(stats.total_shares, 2000);
    assert_eq!(stats.depositor_count, 1);
    assert_eq!(stats.total_yield_distributed, 0);
    assert_eq!(pool_client.get_depositor_count(&token_id), 1);

    // provider2 redeems 2000 shares → 2000 assets.
    pool_client.withdraw(&provider2, &token_id, &2000, &0);
    let stats = pool_client.get_pool_stats(&token_id);
    assert_eq!(stats.total_deposits, 0);
    assert_eq!(stats.total_shares, 0);
    assert_eq!(stats.depositor_count, 0);
    assert_eq!(stats.total_yield_distributed, 0);
    assert_eq!(pool_client.get_depositor_count(&token_id), 0);
    assert_eq!(pool_client.get_total_yield_distributed(&token_id), 0);
}

// ── Additional coverage tests ─────────────────────────────────────────────────

#[test]
fn test_double_initialize_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);

    pool_client.initialize(&admin);
    let result = pool_client.try_initialize(&admin);
    assert!(result.is_err());
}

#[test]
fn test_accept_admin_with_no_proposed_returns_error() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);

    let result = pool_client.try_accept_admin();
    assert!(result.is_err());
}

#[test]
fn test_deposit_blocked_when_paused() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &1_000);

    pool_client.pause();
    assert!(pool_client.is_paused());

    let result = pool_client.try_deposit(&provider, &token_id, &500, &0);
    assert!(result.is_err());

    pool_client.unpause();
    assert!(!pool_client.is_paused());
}

#[test]
fn test_withdraw_blocked_when_paused() {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);
    pool_client.set_withdrawal_cooldown(&0);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &1_000);
    pool_client.deposit(&provider, &token_id, &1_000, &0);

    pool_client.pause();
    let result = pool_client.try_withdraw(&provider, &token_id, &500, &0);
    assert!(result.is_err());
}

#[test]
fn test_get_admin_returns_initialized_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);

    assert_eq!(pool_client.get_admin(), admin);
}

#[test]
fn test_get_depositor_yield_no_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_id, _, _) = create_token_contract(&env, &admin);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);

    let provider = Address::generate(&env);
    assert_eq!(
        pool_client.get_depositor_yield(&provider, &token_id),
        (0, 0)
    );
}

#[test]
fn test_get_depositor_yield_reflects_accrued_interest() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _) = create_token_contract(&env, &admin);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);
    pool_client.set_withdrawal_cooldown(&0);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &1000);
    pool_client.deposit(&provider, &token_id, &1000, &0);

    // Before any yield: asset_value == deposit amount.
    let (shares, asset_value) = pool_client.get_depositor_yield(&provider, &token_id);
    assert_eq!(shares, 1000);
    assert_eq!(asset_value, 1000);

    // Simulate interest repaid into the pool through the accrual path
    // (increases managed assets without minting new shares, so each share
    // is now worth more).
    stellar_asset_client.mint(&admin, &200);
    pool_client.distribute_yield(&admin, &token_id, &200);

    let (shares2, asset_value2) = pool_client.get_depositor_yield(&provider, &token_id);
    assert_eq!(shares2, 1000);
    // 1000 * (1200 + 1000) / (1000 + 1000) = 1100.
    assert_eq!(asset_value2, 1100);
}

#[test]
fn test_multiple_tokens_independence() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token1_id, stellar1, _) = create_token_contract(&env, &admin);
    let (token2_id, stellar2, _) = create_token_contract(&env, &admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);
    pool_client.set_withdrawal_cooldown(&0);

    let provider = Address::generate(&env);
    stellar1.mint(&provider, &1000);
    stellar2.mint(&provider, &2000);

    // Deposit token 1
    pool_client.deposit(&provider, &token1_id, &1000, &0);
    assert_eq!(pool_client.get_shares(&provider, &token1_id), 1000);
    assert_eq!(pool_client.get_shares(&provider, &token2_id), 0);

    // Deposit token 2
    pool_client.deposit(&provider, &token2_id, &2000, &0);
    assert_eq!(pool_client.get_shares(&provider, &token2_id), 2000);
    assert_eq!(pool_client.get_shares(&provider, &token1_id), 1000);

    // Verify stats are separate
    assert_eq!(pool_client.get_total_deposits(&token1_id), 1000);
    assert_eq!(pool_client.get_total_deposits(&token2_id), 2000);
}

#[test]
#[should_panic]
fn test_set_max_pool_size_unauthorized() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let (token_id, _, _) = create_token_contract(&env, &admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &user,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &pool_id,
            fn_name: "set_max_pool_size",
            args: (token_id.clone(), 1000i128).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    pool_client.set_max_pool_size(&token_id, &1000);
}

#[test]
fn test_accept_admin_flow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);

    pool_client.propose_admin(&new_admin);

    // Non-proposed admin cannot accept
    let other = Address::generate(&env);
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &other,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &pool_id,
            fn_name: "accept_admin",
            args: ().into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let res = pool_client.try_accept_admin();
    assert!(res.is_err());

    // Proposed admin can accept
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &new_admin,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &pool_id,
            fn_name: "accept_admin",
            args: ().into_val(&env),
            sub_invokes: &[],
        },
    }]);
    pool_client.accept_admin();
    assert_eq!(pool_client.get_admin(), new_admin);
}

#[test]
fn test_withdrawal_with_utilization() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_id, stellar, token_client) = create_token_contract(&env, &admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);
    pool_client.set_withdrawal_cooldown(&0);

    let provider = Address::generate(&env);
    stellar.mint(&provider, &1000);
    pool_client.deposit(&provider, &token_id, &1000, &0);

    // Simulate 80% utilization (800 tokens borrowed); principal is tracked
    // via adjust_outstanding so pricing (share value) is unaffected by the
    // idle-balance drop.
    let borrower = Address::generate(&env);
    token_client.transfer(&pool_id, &borrower, &800);
    pool_client.adjust_outstanding(&token_id, &800);
    assert_eq!(token_client.balance(&pool_id), 200);

    // Stats should show 80% utilization
    let stats = pool_client.get_pool_stats(&token_id);
    assert_eq!(stats.utilization_bps, 8000);

    // The provider's 500 shares are still worth their full principal value
    // (utilization does not dilute share price), but only 200 tokens are
    // actually liquid. The withdrawal must revert with InsufficientLiquidity
    // rather than silently paying out less than the shares are worth
    // (#1380 bound-safety invariant).
    let result = pool_client.try_withdraw(&provider, &token_id, &500, &0);
    assert_eq!(result, Err(Ok(crate::PoolError::InsufficientLiquidity)));
    assert_eq!(token_client.balance(&provider), 0);
}

#[test]
fn test_deposit_at_max_cap_edge_cases() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_id, stellar, _) = create_token_contract(&env, &admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);
    pool_client.set_max_pool_size(&token_id, &1000);

    let provider = Address::generate(&env);
    stellar.mint(&provider, &1500);

    // Exactly at cap
    pool_client.deposit(&provider, &token_id, &1000, &0);
    assert_eq!(pool_client.get_total_deposits(&token_id), 1000);

    // One more should fail
    let res = pool_client.try_deposit(&provider, &token_id, &1, &0);
    assert!(res.is_err());
}

#[test]
fn test_unauthorized_admin_actions() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);

    // Mock auth as non-admin user
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &user,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &pool_id,
            fn_name: "pause",
            args: ().into_val(&env),
            sub_invokes: &[],
        },
    }]);
    assert!(pool_client.try_pause().is_err());

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &user,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &pool_id,
            fn_name: "unpause",
            args: ().into_val(&env),
            sub_invokes: &[],
        },
    }]);
    assert!(pool_client.try_unpause().is_err());

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &user,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &pool_id,
            fn_name: "set_withdrawal_cooldown",
            args: (100u32,).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    assert!(pool_client.try_set_withdrawal_cooldown(&100).is_err());

    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &user,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &pool_id,
            fn_name: "propose_admin",
            args: (user.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    assert!(pool_client.try_propose_admin(&user).is_err());
}

#[test]
fn test_deposit_event_emission() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_id, stellar, _) = create_token_contract(&env, &admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);
    pool_client.set_withdrawal_cooldown(&0);

    let provider = Address::generate(&env);
    stellar.mint(&provider, &1000);

    pool_client.deposit(&provider, &token_id, &1000, &0);

    // Verify events
    // Event structure from events.rs:
    // pub fn deposit(env: &Env, provider: Address, token: Address, amount: i128, shares: i128)
    // env.events().publish((Symbol::new(env, "Deposit"), provider, token), (amount, shares));

    let events = env.events().all();
    let deposit_event = events.get(events.len() - 1).unwrap();

    // We expect the last event to be the Deposit event.
    // In Soroban tests, events are (topics, data).
    // Topics: [Deposit, provider, token]
    // Data: [amount, shares]

    let data_vec = soroban_sdk::Vec::<i128>::try_from_val(&env, &deposit_event.2).unwrap();
    assert_eq!(data_vec.get(0).unwrap(), 1000i128);
    assert_eq!(data_vec.get(1).unwrap(), 1000i128);
}

// ── LendingPool share-based accounting tests ──────────────────────────────────

#[test]
fn test_share_price_is_one_to_one_before_any_yield() {
    // The very first depositor should always receive exactly 1 share per token
    // deposited, and the share price should be 1:1 (scaled by SHARE_PRICE_SCALE).
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);
    pool_client.set_withdrawal_cooldown(&0);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5_000);
    pool_client.deposit(&provider, &token_id, &5_000, &0);

    // 1:1 share allocation for the first depositor.
    assert_eq!(pool_client.get_shares(&provider, &token_id), 5_000);
    assert_eq!(pool_client.get_total_shares(&token_id), 5_000);

    // Share price = pool_balance * SHARE_PRICE_SCALE / total_shares
    //             = 5000 * 1_000_000 / 5000 = 1_000_000 (i.e. 1.0).
    let share_price = pool_client.get_share_price(&token_id);
    assert_eq!(share_price, 1_000_000);
}

#[test]
fn test_share_price_rises_proportionally_with_yield() {
    // After interest is deposited into the pool the share price must increase
    // proportionally, and a partial redemption must return the correct amount.
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);
    pool_client.set_withdrawal_cooldown(&0);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &2_000);
    pool_client.deposit(&provider, &token_id, &2_000, &0); // 2000 shares

    // 500 tokens of interest arrive (25 % yield) through the accrual path.
    stellar_asset_client.mint(&token_admin, &500);
    pool_client.distribute_yield(&token_admin, &token_id, &500);
    // Managed: 2500 | Shares: 2000
    // price = (2500 + 1000) * 1_000_000 / (2000 + 1000) = 1_166_666.
    let share_price = pool_client.get_share_price(&token_id);
    assert_eq!(share_price, 1_166_666);

    // Redeem half the shares (1000):
    // 1000 * (2500 + 1000) / (2000 + 1000) = 1166.
    pool_client.withdraw(&provider, &token_id, &1_000, &0);
    assert_eq!(token_client.balance(&provider), 1_166); // 0 initial + 1166 redeemed
    assert_eq!(pool_client.get_shares(&provider, &token_id), 1_000);
}

#[test]
fn test_multiple_depositors_share_yield_proportionally_and_total_shares_track_correctly() {
    // Three providers deposit different amounts.  Yield arrives.  Each provider
    // redeems all their shares and must receive principal + their pro-rata yield.
    // After all redemptions total_shares must be zero.
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_admin);
    pool_client.set_withdrawal_cooldown(&0);

    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    let p3 = Address::generate(&env);
    stellar_asset_client.mint(&p1, &5_000);
    stellar_asset_client.mint(&p2, &3_000);
    stellar_asset_client.mint(&p3, &2_000);

    // Deposits: p1=5000, p2=3000, p3=2000 → total pool=10000, total_shares=10000.
    pool_client.deposit(&p1, &token_id, &5_000, &0);
    pool_client.deposit(&p2, &token_id, &3_000, &0);
    pool_client.deposit(&p3, &token_id, &2_000, &0);

    assert_eq!(pool_client.get_total_shares(&token_id), 10_000);

    // 1000 tokens of interest arrive (10 % yield) through the accrual path.
    stellar_asset_client.mint(&token_admin, &1_000);
    pool_client.distribute_yield(&token_admin, &token_id, &1_000);
    // Managed: 11000 | Shares: 10000

    // Each provider redeems all shares (virtual-offset formula, rounded down).
    // p1: 5000 * (11000 + 1000) / (10000 + 1000) = 5454
    pool_client.withdraw(&p1, &token_id, &5_000, &0);
    assert_eq!(token_client.balance(&p1), 5_454);

    // p2: 3000 * (5546 + 1000) / (5000 + 1000) = 3273
    // (managed=5546, shares=5000 after p1 exit)
    pool_client.withdraw(&p2, &token_id, &3_000, &0);
    assert_eq!(token_client.balance(&p2), 3_273);

    // p3: 2000 * (2273 + 1000) / (2000 + 1000) = 2182
    // (managed=2273, shares=2000 after p1+p2 exit)
    pool_client.withdraw(&p3, &token_id, &2_000, &0);
    assert_eq!(token_client.balance(&p3), 2_182);

    // No shares remain; dust is left in the pool, in the pool's favor.
    assert_eq!(token_client.balance(&pool_id), 91);
    assert_eq!(pool_client.get_total_shares(&token_id), 0);
}

// ── adjust_outstanding tests ─────────────────────────────────────────────────

#[test]
fn test_adjust_outstanding_positive_delta_increases_total() {
    // Regression test for #1356: adjust_outstanding subtracted delta instead
    // of adding it, so a positive delta (e.g. a new disbursement growing the
    // pool's recorded debt) shrank total_outstanding instead of growing it.
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);

    assert_eq!(pool_client.get_total_outstanding(&token), 0);

    pool_client.adjust_outstanding(&token, &1_500);

    assert_eq!(pool_client.get_total_outstanding(&token), 1_500);
}

#[test]
fn test_adjust_outstanding_negative_delta_decreases_total() {
    // Regression test for #1356: a negative delta (e.g. a repayment shrinking
    // recorded debt) must decrease total_outstanding.
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);

    pool_client.adjust_outstanding(&token, &2_000);
    assert_eq!(pool_client.get_total_outstanding(&token), 2_000);

    pool_client.adjust_outstanding(&token, &-800);

    assert_eq!(pool_client.get_total_outstanding(&token), 1_200);
}

#[test]
fn test_adjust_outstanding_zero_delta_is_a_no_op() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);

    pool_client.adjust_outstanding(&token, &1_000);
    pool_client.adjust_outstanding(&token, &0);

    assert_eq!(pool_client.get_total_outstanding(&token), 1_000);
}

// ── #1380: slippage bounds & virtual-share/asset offset ───────────────────────
//
// These tests reproduce the single-ledger share-price manipulation described
// in #1380 and assert it is now prevented: a bare token transfer to the
// pool's address ("donation") cannot move the share price, the classic
// first-depositor inflation attack is defused by the virtual offset, and
// `min_shares_out`/`min_assets_out` cause settlement to revert rather than
// execute at a worse price than the caller expected.

#[test]
fn test_donation_to_pool_address_does_not_move_share_price() {
    // The exact extraction walkthrough from #1380, replayed against the
    // fixed contract: attacker deposits a token unit, donates a huge amount
    // directly to the pool's token balance (bypassing `deposit`), then a
    // victim deposits. Under the pre-fix code the victim would be minted
    // zero shares and the attacker could redeem the victim's principal.
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_id, stellar, token_client) = create_token_contract(&env, &admin);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);
    pool_client.set_withdrawal_cooldown(&0);

    let attacker = Address::generate(&env);
    let victim = Address::generate(&env);
    stellar.mint(&attacker, &1_000_001);
    stellar.mint(&victim, &1_000_000);

    // Step 1-2: attacker deposits 1 unit, first-depositor path -> 1 share.
    pool_client.deposit(&attacker, &token_id, &1, &0);
    assert_eq!(pool_client.get_shares(&attacker, &token_id), 1);
    let price_before_donation = pool_client.get_share_price(&token_id);

    // Step 3: attacker donates 1_000_000 of their *own* funds directly to
    // the pool's address (a bare transfer, not `deposit`), completely
    // bypassing the deposit accounting. Under the old balance-derived
    // pricing this alone would have repriced every share; here it must be
    // a no-op for accounting purposes.
    token_client.transfer(&attacker, &pool_id, &1_000_000);
    assert_eq!(
        pool_client.get_pool_stats(&token_id).total_managed_assets,
        1,
        "an unsolicited transfer must not move total_managed_assets"
    );
    assert_eq!(
        pool_client.get_share_price(&token_id),
        price_before_donation,
        "an unsolicited transfer must not move the share price"
    );

    // Step 4: victim deposits 1_000_000. Under the pre-fix formula this
    // would compute 1_000_000 * 1 / 1_000_001 = 0 shares. Here the victim
    // is priced fairly, independent of the donation.
    pool_client.deposit(&victim, &token_id, &1_000_000, &0);
    let victim_shares = pool_client.get_shares(&victim, &token_id);
    assert_eq!(
        victim_shares, 1_000_000,
        "victim must be minted fair shares, unaffected by the donation"
    );

    // Step 5: attacker redeems their single share. Under the pre-fix code
    // this would have drained the victim's deposit plus the donation
    // (assets = 1 * 2_000_001 / 1 = 2_000_001). Here the attacker recovers
    // only their own principal; the donated 1_000_000 is not recoverable
    // through the share mechanism at all.
    pool_client.withdraw(&attacker, &token_id, &1, &0);
    assert_eq!(
        token_client.balance(&attacker),
        1, // 0 remaining wallet (spent 1_000_001) + 1 redeemed
        "attacker must not be able to extract the victim's deposit or the donation"
    );

    // The victim can redeem their full principal.
    pool_client.withdraw(&victim, &token_id, &1_000_000, &0);
    assert_eq!(token_client.balance(&victim), 1_000_000);
}

#[test]
fn test_virtual_offset_prevents_first_depositor_inflation_attack() {
    // Sanity-checks the virtual-offset math in isolation (independent of the
    // total_managed_assets donation-independence fix above): even if a
    // "total assets" figure were still manipulated, the offset alone
    // prevents the classic inflation attack of rounding a victim's minted
    // shares down to zero.
    let attacker_shares = LendingPool::calc_shares_to_mint(1, 0, 0);
    assert_eq!(attacker_shares, 1);

    // Hypothetical manipulated pricing input: 1 share backed by 1_000_001
    // (a) assets, as if a 1_000_000 donation had been counted.
    let manipulated_total_assets = 1_000_001;

    let victim_shares =
        LendingPool::calc_shares_to_mint(1_000_000, manipulated_total_assets, attacker_shares);
    assert!(
        victim_shares > 0,
        "the virtual offset must prevent the victim's shares from rounding to zero"
    );
    assert_eq!(victim_shares, 999);

    // The attacker's payoff for spending 1_000_000 on the donation plus 1 on
    // the deposit is bounded by the offset to a dust-level share of the
    // pool -- ruinously unprofitable.
    let attacker_assets = LendingPool::calc_assets_to_redeem(
        attacker_shares,
        manipulated_total_assets + 1_000_000,
        attacker_shares + victim_shares,
    );
    assert!(
        attacker_assets < 1_100,
        "attacker must not be able to extract a meaningful share of the pool"
    );
}

#[test]
fn test_deposit_rejects_when_below_min_shares_out() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_id, stellar, token_client) = create_token_contract(&env, &admin);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);

    let provider = Address::generate(&env);
    stellar.mint(&provider, &1_000);

    // First deposit would mint exactly 1000 shares (1:1); demand more.
    let result = pool_client.try_deposit(&provider, &token_id, &1_000, &1_001);
    assert_eq!(result, Err(Ok(crate::PoolError::MinSharesNotMet)));

    // The settlement must not have partially executed: no shares minted,
    // no tokens moved.
    assert_eq!(pool_client.get_shares(&provider, &token_id), 0);
    assert_eq!(token_client.balance(&provider), 1_000);
    assert_eq!(token_client.balance(&pool_id), 0);
}

#[test]
fn test_deposit_succeeds_when_min_shares_out_is_met() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_id, stellar, _) = create_token_contract(&env, &admin);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);

    let provider = Address::generate(&env);
    stellar.mint(&provider, &1_000);

    pool_client.deposit(&provider, &token_id, &1_000, &1_000);
    assert_eq!(pool_client.get_shares(&provider, &token_id), 1_000);
}

#[test]
fn test_withdraw_rejects_when_below_min_assets_out() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_id, stellar, token_client) = create_token_contract(&env, &admin);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);
    pool_client.set_withdrawal_cooldown(&0);

    let provider = Address::generate(&env);
    stellar.mint(&provider, &1_000);
    pool_client.deposit(&provider, &token_id, &1_000, &0);

    // Redeeming all 1000 shares at 1:1 returns exactly 1000; demand more.
    let result = pool_client.try_withdraw(&provider, &token_id, &1_000, &1_001);
    assert_eq!(result, Err(Ok(crate::PoolError::MinAssetsNotMet)));

    // Settlement must not have partially executed.
    assert_eq!(pool_client.get_shares(&provider, &token_id), 1_000);
    assert_eq!(token_client.balance(&pool_id), 1_000);
}

#[test]
fn test_distribute_yield_requires_source_authorization() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_id, stellar, _) = create_token_contract(&env, &admin);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);

    let source = Address::generate(&env);
    stellar.mint(&source, &100);

    env.mock_auths(&[]); // Enforce require_auth() natively.
    let result = pool_client.try_distribute_yield(&source, &token_id, &100);
    assert!(result.is_err());
    assert_eq!(
        pool_client.get_pool_stats(&token_id).total_managed_assets,
        0
    );
}

#[test]
fn test_preview_deposit_and_preview_redeem_match_settlement() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_id, stellar, _) = create_token_contract(&env, &admin);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);
    pool_client.set_withdrawal_cooldown(&0);

    let provider = Address::generate(&env);
    stellar.mint(&provider, &2_000);

    // preview_deposit before any deposit exists must match what a first
    // deposit actually mints.
    let previewed_shares = pool_client.preview_deposit(&token_id, &1_000);
    pool_client.deposit(&provider, &token_id, &1_000, &0);
    assert_eq!(
        previewed_shares,
        pool_client.get_shares(&provider, &token_id)
    );

    // Yield arrives; preview_redeem must match what withdraw actually pays.
    stellar.mint(&admin, &500);
    pool_client.distribute_yield(&admin, &token_id, &500);

    let previewed_assets = pool_client.preview_redeem(&token_id, &1_000);
    let balance_before = TokenClient::new(&env, &token_id).balance(&provider);
    pool_client.withdraw(&provider, &token_id, &1_000, &0);
    let balance_after = TokenClient::new(&env, &token_id).balance(&provider);
    assert_eq!(previewed_assets, balance_after - balance_before);

    // preview_* must never mutate state.
    assert_eq!(pool_client.get_shares(&provider, &token_id), 0);
}

#[test]
fn test_round_trip_deposit_then_redeem_is_never_profitable() {
    // Property-style check over a range of deposit sizes and pool states
    // (including states perturbed by unsolicited donations): depositing `d`
    // and immediately redeeming all resulting shares must never return more
    // than `d` (round-trip non-profitability, #1380). A fixed-seed
    // xorshift PRNG is used instead of pulling in a property-testing crate.
    fn next(state: &mut u64) -> u64 {
        *state ^= *state << 13;
        *state ^= *state >> 7;
        *state ^= *state << 17;
        *state
    }

    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (token_id, stellar, _) = create_token_contract(&env, &admin);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin);
    pool_client.set_withdrawal_cooldown(&0);

    let mut rng_state: u64 = 0x1234_5678_9abc_def1;
    let attacker = Address::generate(&env);
    stellar.mint(&attacker, &1_000_000_000);

    // Seed the pool with an initial deposit so later rounds start from a
    // nonzero, non-trivial exchange rate.
    pool_client.deposit(&attacker, &token_id, &1_000, &0);

    for _ in 0..25 {
        // A pseudo-random "donation" directly to the pool's address on
        // every round, exercising donation-independence under repeated
        // adversarial interleaving, not just a single occurrence.
        let donation = 1 + (next(&mut rng_state) % 1_000_000) as i128;
        stellar.mint(&pool_id, &donation);

        let provider = Address::generate(&env);
        let deposit_amount = 1 + (next(&mut rng_state) % 1_000_000) as i128;
        stellar.mint(&provider, &deposit_amount);

        pool_client.deposit(&provider, &token_id, &deposit_amount, &0);
        let shares = pool_client.get_shares(&provider, &token_id);
        // A deposit must always mint a nonzero amount of shares given a
        // nonzero amount in; if it can't, ZeroShares would have reverted
        // the call rather than let us reach this point.
        assert!(shares > 0);

        let assets_out = pool_client.preview_redeem(&token_id, &shares);
        assert!(
            assets_out <= deposit_amount,
            "round trip must not be profitable: deposited {deposit_amount}, would redeem {assets_out}"
        );

        pool_client.withdraw(&provider, &token_id, &shares, &0);
    }
}
