#![cfg(test)]

use crate::{LendingPool, LendingPoolClient};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{Address, Env};
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::token::StellarAssetClient;
use test_fuzz::test_fuzz;
use arbitrary::Arbitrary;

fn create_token_contract<'a>(env: &Env, admin: &Address) -> (Address, StellarAssetClient<'a>, TokenClient<'a>) {
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
    pool_client.initialize(&token_id);

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
    let (token_id, _stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_id);

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
    pool_client.initialize(&token_id);

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
    pool_client.initialize(&token_id);

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
    let (token_id, _stellar_asset_client, _token_client) = create_token_contract(&env, &token_admin);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_id);

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
    pool_client.initialize(&token_id);

    let provider = Address::generate(&env);
    stellar_asset_client.mint(&provider, &5000);
    pool_client.deposit(&provider, &1000);

    // Attempt to withdraw more than deposited
    pool_client.withdraw(&provider, &2000);
}

#[derive(Arbitrary, Debug)]
struct FuzzOperation {
    deposit_amount: i128,
    withdraw_amount: i128,
}

#[test_fuzz]
fn test_deposit_withdraw_invariants(operation: FuzzOperation) {
    let env = Env::default();
    env.mock_all_auths();

    // Skip invalid amounts
    if operation.deposit_amount <= 0 || operation.withdraw_amount <= 0 {
        return;
    }

    // Setup mock asset
    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = create_token_contract(&env, &token_admin);

    // Setup LendingPool
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);
    pool_client.initialize(&token_id);

    // Setup provider with sufficient tokens
    let provider = Address::generate(&env);
    let initial_balance = operation.deposit_amount + operation.withdraw_amount;
    stellar_asset_client.mint(&provider, &initial_balance);

    // Deposit
    pool_client.deposit(&provider, &operation.deposit_amount);
    
    // Verify invariants after deposit
    let deposit_balance = pool_client.get_deposit(&provider);
    assert!(deposit_balance >= 0, "Deposit balance should never be negative");
    assert_eq!(deposit_balance, operation.deposit_amount, "Deposit balance should match deposit amount");

    // Withdraw (only if sufficient balance)
    if operation.withdraw_amount <= operation.deposit_amount {
        pool_client.withdraw(&provider, &operation.withdraw_amount);
        
        // Verify invariants after withdrawal
        let final_balance = pool_client.get_deposit(&provider);
        assert!(final_balance >= 0, "Final balance should never be negative");
        assert_eq!(final_balance, operation.deposit_amount - operation.withdraw_amount, 
                  "Final balance should equal deposit minus withdrawal");
    }
}
