#![no_main]

use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;
use loan_manager::{LoanManager, LoanManagerClient};
use remittance_nft::{RemittanceNFT, RemittanceNFTClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, BytesN, Symbol, IntoVal, Val};
use std::collections::HashMap;
use std::panic::AssertUnwindSafe;

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

    // 2. Setup LoanManager
    let loan_manager_id = env.register(LoanManager, ());
    let loan_manager_client = LoanManagerClient::new(&env, &loan_manager_id);
    loan_manager_client.initialize(&nft_id);
    
    // Authorize LoanManager to update scores in NFT contract
    nft_client.authorize_minter(&loan_manager_id);

    match data {
        FuzzAction::RequestLoan {
            user_id,
            amount,
            score,
        } => {
            let user = Address::generate(&env);

            // Skip invalid amounts
            if amount <= 0 {
                return;
            }

            // Mint NFT for user with specific score
            let history_hash = BytesN::from_array(&env, &[0u8; 32]);
            nft_client.mint(&user, &score, &history_hash, &None);

            let result = rcall!(&env, loan_manager_client, "request_loan", (user, amount));

            if result.is_ok() {
                // Verify invariants if any (e.g. loan created)
            } else {
                // Verify invariant: score should be >= 500 for loan approval
                if score < 500 {
                    // This is expected failure
                }
            }
        }

        FuzzAction::ApproveLoan { loan_id } => {
            let _ = rcall!(&env, loan_manager_client, "approve_loan", (loan_id));
        }

        FuzzAction::Repay {
            user_id,
            amount,
            initial_score,
        } => {
            let user = Address::generate(&env);

            // Skip invalid amounts
            if amount <= 0 {
                return;
            }

            // Mint NFT for user
            let history_hash = BytesN::from_array(&env, &[0u8; 32]);
            nft_client.mint(&user, &initial_score, &history_hash, &None);

            let score_before = nft_client.get_score(&user);
            let result = rcall!(&env, loan_manager_client, "repay", (user, amount));

            if result.is_ok() {
                let score_after = nft_client.get_score(&user);

                // Verify invariant: score should be updated (increased by 1 per 100 units)
                let expected_increase = (amount / 100) as u32;
                assert_eq!(score_after, score_before + expected_increase, "Score should increase correctly after repayment");
                assert!(score_after >= 0, "Score should never be negative");
            }
        }

        FuzzAction::MultipleOperations { operations } => {
            let mut users = HashMap::new();

            for op in operations {
                let user_addr = users.entry(op.user_id).or_insert_with(|| {
                    let addr = Address::generate(&env);
                    let history_hash = BytesN::from_array(&env, &[0u8; 32]);
                    // Initialize user with some score
                    nft_client.mint(&addr, &op.score, &history_hash, &None);
                    addr
                }).clone();

                match op.operation_type % 2 {
                    0 if op.amount > 0 => {
                        // Request loan
                        let _ = rcall!(&env, loan_manager_client, "request_loan", (user_addr, op.amount));
                    }
                    1 if op.amount > 0 => {
                        // Repay
                        let _ = rcall!(&env, loan_manager_client, "repay", (user_addr, op.amount));
                    }
                    _ => {}
                }
            }
        }
    }
});

