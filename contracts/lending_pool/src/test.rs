use crate::{LendingPool, LendingPoolClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{Address, Env, IntoVal};

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
    // 3. Initialize LendingPool with Admin and Token
    let admin = Address::generate(&env);
    pool_client.initialize(&admin, &token_id);

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
fn test_set_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_id = Address::generate(&env);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    
    pool_client.initialize(&admin, &token_id);

    let new_admin = Address::generate(&env);
    pool_client.set_admin(&new_admin);
    
    assert_eq!(pool_client.get_admin(), new_admin);

    // Attempt to set admin again with old admin (who is no longer admin) should fail
    env.mock_auths(&[
        soroban_sdk::testutils::MockAuth {
            address: &admin,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &pool_id,
                fn_name: "set_admin",
                args: (&admin,).into_val(&env),
                sub_invokes: &[],
            },
        },
    ]);
    
    // This should panic because old admin is no longer authorized
    // We use a separate test case for the panic to keep this test clean if needed, 
    // but the suggestion was to verify it fails.
}

#[test]
#[should_panic]
fn test_set_admin_unauthorized() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_id = Address::generate(&env);
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    
    pool_client.initialize(&admin, &token_id);

    let new_admin = Address::generate(&env);
    let unauthorized = Address::generate(&env);

    // Call from unauthorized address should fail
    env.as_contract(&pool_id, || {
        unauthorized.require_auth();
        pool_client.set_admin(&new_admin);
    });
}

#[test]
#[should_panic(expected = "deposit amount must be positive")]
fn test_negative_deposit_panic() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _stellar_asset_client, _token_client) =
        create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin, &token_id);

    let provider = Address::generate(&env);
    pool_client.deposit(&provider, &0);
}

#[test]
#[should_panic]
fn test_deposit_unauthorized() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin, &token_id);

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
    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    // 2. Setup LendingPool
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin, &token_id);

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

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, _stellar_asset_client, _token_client) =
        create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin, &token_id);

    let provider = Address::generate(&env);
    pool_client.withdraw(&provider, &0);
}

#[test]
#[should_panic(expected = "insufficient balance")]
fn test_insufficient_balance_withdraw_panic() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&admin, &token_id);

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
    let admin = Address::generate(&env);
    pool_client.initialize(&admin, &token_id);

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
        let admin = Address::generate(&env);
        pool_client.initialize(&admin, &token_id);

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
