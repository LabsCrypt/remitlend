#![no_main]

use arbitrary::Arbitrary;
use lending_pool::{LendingPool, LendingPoolClient};
use libfuzzer_sys::fuzz_target;
use loan_manager::{LoanManager, LoanManagerClient};
use remittance_nft::{RemittanceNFT, RemittanceNFTClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{Address, BytesN, Env, IntoVal, Symbol, Val};
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

#[derive(Arbitrary, Debug)]
enum FuzzAction {
    RequestLoan {
        user_id: u8,
        amount: i128,
        score: u32,
    },
    ApproveLoan {
        loan_id: u32,
    },
    Repay {
        user_id: u8,
        amount: i128,
        initial_score: u32,
    },
    MultipleOperations {
        operations: Vec<LoanOperation>,
    },
}

#[derive(Arbitrary, Debug)]
struct LoanOperation {
    user_id: u8,
    amount: i128,
    score: u32,
    operation_type: u8, // 0: request, 1: repay
}

fuzz_target!(|data: FuzzAction| {
    let env = Env::default();
    env.mock_all_auths();

    // 1. Setup RemittanceNFT
    let nft_id = env.register(RemittanceNFT, ());
    let nft_client = RemittanceNFTClient::new(&env, &nft_id);
    let admin = Address::generate(&env);
    nft_client.initialize(&admin);
    nft_client.set_min_repayment_amount(&0);

    // 2. Setup mock token
    let token_admin = Address::generate(&env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_id = token_contract_id.address();
    let stellar_token = StellarAssetClient::new(&env, &token_id);

    // 3. Setup LendingPool
    let lending_pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(&env, &lending_pool_id);
    pool_client.initialize(&admin);

    // 4. Setup LoanManager
    let loan_manager_id = env.register(LoanManager, ());
    let loan_manager_client = LoanManagerClient::new(&env, &loan_manager_id);

    // Authorize LoanManager on NFT and LendingPool before initializing
    nft_client.authorize_minter(&loan_manager_id);
    loan_manager_client.initialize(&nft_id, &lending_pool_id, &token_id, &admin);
    pool_client.set_loan_manager(&loan_manager_id);

    // Configure limits so fuzzed values in range succeed as expected
    loan_manager_client.set_max_loan_amount(&10_000_000_000);
    loan_manager_client.set_min_repayment_amount(&0);

    // Fund the lending pool with plenty of liquidity so disbursements don't fail
    stellar_token.mint(&lending_pool_id, &1_000_000_000_000);

    match data {
        FuzzAction::RequestLoan {
            user_id: _,
            amount,
            score,
        } => {
            let user = Address::generate(&env);

            // Skip invalid amounts or amounts exceeding maximum loan amount (100,000 stroops minimum up to 10,000,000,000)
            if amount <= 0 || amount > 10_000_000_000 {
                return;
            }

            let clamped_score = score.clamp(300, 850);

            // Mint NFT for user with specific score
            let history_hash = BytesN::from_array(&env, &[0u8; 32]);
            nft_client.mint(
                &user,
                &clamped_score,
                &history_hash,
                &soroban_sdk::String::from_str(&env, "ipfs://test"),
                &BytesN::from_array(&env, &[0u8; 32]),
                &None,
            );

            let term = 30u32;
            let result = rcall!(&env, loan_manager_client, "request_loan", (user, amount, term));

            if clamped_score < 500 {
                // Must fail loudly if a below-threshold request unexpectedly succeeds (#2243)
                assert!(
                    result.is_err(),
                    "request_loan must fail when score < 500 (score was {})",
                    clamped_score
                );
            } else {
                // Must fail loudly if an eligible borrower request fails (#2243)
                assert!(
                    result.is_ok(),
                    "request_loan must succeed when score >= 500 (score was {}): {:?}",
                    clamped_score,
                    result.err()
                );
            }
        }

        FuzzAction::ApproveLoan { loan_id } => {
            let _ = rcall!(&env, loan_manager_client, "approve_loan", (loan_id));
        }

        FuzzAction::Repay {
            user_id: _,
            amount,
            initial_score,
        } => {
            let user = Address::generate(&env);

            // Skip invalid amounts
            if amount <= 0 || amount > 10_000_000_000 {
                return;
            }

            // Mint NFT for user with eligible score >= 500
            let score = initial_score.clamp(500, 850);
            let history_hash = BytesN::from_array(&env, &[0u8; 32]);
            nft_client.mint(
                &user,
                &score,
                &history_hash,
                &soroban_sdk::String::from_str(&env, "ipfs://test"),
                &BytesN::from_array(&env, &[0u8; 32]),
                &None,
            );

            let term = 30u32;
            let loan_id = loan_manager_client.request_loan(&user, &amount, &term);
            loan_manager_client.approve_loan(&loan_id);

            // Mint tokens to user for repayment
            let stellar_token = StellarAssetClient::new(&env, &token_id);
            stellar_token.mint(&user, &amount);

            let score_before = nft_client.get_score(&user);
            let result = rcall!(&env, loan_manager_client, "repay", (user, loan_id, amount));

            // Harness must fail loudly when expected-success call errors (#2243)
            assert!(
                result.is_ok(),
                "repay must succeed for active loan {} with amount {}: {:?}",
                loan_id,
                amount,
                result.err()
            );

            let score_after = nft_client.get_score(&user);
            assert!(
                score_after >= score_before,
                "Score should not decrease after repayment"
            );
        }

        FuzzAction::MultipleOperations { operations } => {
            let mut users = HashMap::new();
            let stellar_token = StellarAssetClient::new(&env, &token_id);

            for op in operations {
                let clamped_score = op.score.clamp(300, 850);
                let user_addr = users
                    .entry(op.user_id)
                    .or_insert_with(|| {
                        let addr = Address::generate(&env);
                        let history_hash = BytesN::from_array(&env, &[0u8; 32]);
                        nft_client.mint(
                            &addr,
                            &clamped_score,
                            &history_hash,
                            &soroban_sdk::String::from_str(&env, "ipfs://test"),
                            &BytesN::from_array(&env, &[0u8; 32]),
                            &None,
                        );
                        addr
                    })
                    .clone();

                match op.operation_type % 2 {
                    0 if op.amount > 0 && op.amount <= 10_000_000_000 => {
                        let term = 30u32;
                        let result = rcall!(
                            &env,
                            loan_manager_client,
                            "request_loan",
                            (user_addr, op.amount, term)
                        );
                        if clamped_score < 500 {
                            assert!(result.is_err(), "request_loan must fail when score < 500");
                        }
                    }
                    1 if op.amount > 0 && op.amount <= 10_000_000_000 => {
                        stellar_token.mint(&user_addr, &op.amount);
                        let _ = rcall!(&env, loan_manager_client, "repay", (user_addr, 1u32, op.amount));
                    }
                    _ => {}
                }
            }
        }
    }
});
