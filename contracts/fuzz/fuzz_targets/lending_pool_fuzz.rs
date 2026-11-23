#![no_main]

use arbitrary::Arbitrary;
use lending_pool::{LendingPool, LendingPoolClient};
use libfuzzer_sys::fuzz_target;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
use soroban_sdk::{Address, Env, IntoVal, Symbol, Val};
use std::collections::HashMap;

macro_rules! rcall {
    ($env:expr, $client:expr, $func:expr, ($($arg:expr),*)) => {
        $env.try_invoke_contract::<Val, Val>(
            &$client.address,
            &Symbol::new($env, $func),
            ($($arg.clone(),)*).into_val($env)
        )
    };
}

const MAX_AMOUNT: i128 = 100_000_000_000_000_000; // 10^17 stroops (prevents i128 multiplication overflow)

#[derive(Arbitrary, Debug)]
enum FuzzAction {
    Deposit { user_id: u8, amount: i128 },
    Withdraw { user_id: u8, amount: i128 },
    GetDeposit { user_id: u8 },
    MultipleOperations { operations: Vec<Operation> },
}

#[derive(Arbitrary, Debug)]
struct Operation {
    user_id: u8,
    amount: i128,
    is_deposit: bool,
}

fn setup_token_contract<'a>(
    env: &Env,
    admin: &Address,
) -> (Address, StellarAssetClient<'a>, TokenClient<'a>) {
    let contract_id = env.register_stellar_asset_contract_v2(admin.clone());
    let stellar_asset_client = StellarAssetClient::new(env, &contract_id.address());
    let token_client = TokenClient::new(env, &contract_id.address());
    (contract_id.address(), stellar_asset_client, token_client)
}

fuzz_target!(|data: FuzzAction| {
    let env = Env::default();
    env.mock_all_auths();

    // 1. Setup mock asset
    let token_admin = Address::generate(&env);
    let (token_id, stellar_asset_client, token_client) = setup_token_contract(&env, &token_admin);

    // 2. Setup LendingPool
    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &pool_id);

    // 3. Initialize LendingPool with Token
    let pool_admin = Address::generate(&env);
    pool_client.initialize(&pool_admin);
    pool_client.set_withdrawal_cooldown(&0);

    match data {
        FuzzAction::Deposit { user_id: _, amount } => {
            let user = Address::generate(&env);

            // Skip invalid amounts or amounts that exceed safe multiplication limit
            if amount <= 0 || amount > MAX_AMOUNT {
                return;
            }

            // Mint tokens to user
            stellar_asset_client.mint(&user, &amount);

            let min_shares_out = 0i128;
            let result = rcall!(&env, pool_client, "deposit", (user, token_id, amount, min_shares_out));

            // Harness must fail loudly when expected-success call errors (#2243)
            assert!(
                result.is_ok(),
                "deposit must succeed for positive amount {}: {:?}",
                amount,
                result.err()
            );

            // Verify invariant: deposit should increase user balance
            let balance = pool_client.get_deposit(&user, &token_id);
            assert!(balance >= 0, "Balance should never be negative");
            assert!(balance <= amount, "Redeemable assets should not exceed deposited amount");

            // Verify pool token balance
            assert_eq!(
                token_client.balance(&pool_id),
                amount,
                "Pool token balance should match deposit"
            );
        }

        FuzzAction::Withdraw { user_id: _, amount } => {
            let user = Address::generate(&env);

            // Skip invalid amounts or excessive amounts
            if amount <= 0 || amount > MAX_AMOUNT / 2 {
                return;
            }

            // First deposit some amount to allow withdrawal
            let deposit_amount = match amount.checked_mul(2) {
                Some(v) => v,
                None => return,
            };
            stellar_asset_client.mint(&user, &deposit_amount);
            pool_client.deposit(&user, &token_id, &deposit_amount, &0);

            let balance_before = pool_client.get_deposit(&user, &token_id);
            let user_shares = pool_client.get_shares(&user, &token_id);
            let shares_to_withdraw = user_shares / 2;
            if shares_to_withdraw <= 0 {
                return;
            }

            let min_assets_out = 0i128;
            let result = rcall!(&env, pool_client, "withdraw", (user, token_id, shares_to_withdraw, min_assets_out));

            // Harness must fail loudly when expected-success call errors (#2243)
            assert!(
                result.is_ok(),
                "withdraw must succeed for valid shares {}: {:?}",
                shares_to_withdraw,
                result.err()
            );

            let balance_after = pool_client.get_deposit(&user, &token_id);

            // Verify invariant: balance should decrease after withdrawal
            assert!(
                balance_after < balance_before,
                "Balance should decrease after withdrawal"
            );
            assert!(balance_after >= 0, "Balance should never be negative");

            // Verify pool token balance decreased
            assert!(
                token_client.balance(&pool_id) < deposit_amount,
                "Pool token balance mismatch after withdrawal"
            );
        }

        FuzzAction::GetDeposit { user_id: _ } => {
            let user = Address::generate(&env);
            let balance = pool_client.get_deposit(&user, &token_id);

            // Verify invariant: balance should never be negative
            assert!(balance >= 0, "Balance should never be negative");
        }

        FuzzAction::MultipleOperations { operations } => {
            let mut users = HashMap::new();
            let mut _total_expected_deposits = 0i128;

            for op in operations {
                let user_addr = users
                    .entry(op.user_id)
                    .or_insert_with(|| Address::generate(&env))
                    .clone();

                if op.is_deposit {
                    if op.amount <= 0 || op.amount > MAX_AMOUNT {
                        continue;
                    }

                    stellar_asset_client.mint(&user_addr, &op.amount);
                    let result = rcall!(&env, pool_client, "deposit", (user_addr, token_id, op.amount, 0i128));
                    assert!(
                        result.is_ok(),
                        "deposit must succeed for positive amount {}: {:?}",
                        op.amount,
                        result.err()
                    );
                    _total_expected_deposits += op.amount;
                } else {
                    if op.amount <= 0 || op.amount > MAX_AMOUNT {
                        continue;
                    }

                    let shares = pool_client.get_shares(&user_addr, &token_id);
                    if shares <= 0 {
                        let result = rcall!(&env, pool_client, "withdraw", (user_addr, token_id, op.amount, 0i128));
                        assert!(result.is_err(), "withdraw without shares must fail");
                    } else {
                        let shares_to_withdraw = if op.amount > shares { shares } else { op.amount };
                        let balance_before = token_client.balance(&pool_id);
                        let result = rcall!(&env, pool_client, "withdraw", (user_addr, token_id, shares_to_withdraw, 0i128));
                        if result.is_ok() {
                            let balance_after = token_client.balance(&pool_id);
                            assert!(balance_after <= balance_before, "Pool token balance must decrease or stay same after withdraw");
                        }
                    }
                }
            }

            // Verify all individual balances are non-negative
            for (_, user_addr) in users {
                assert!(
                    pool_client.get_deposit(&user_addr, &token_id) >= 0,
                    "Individual balance should never be negative"
                );
            }
        }
    }
});
