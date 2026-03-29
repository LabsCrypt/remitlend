#![no_main]

use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;
use remittance_nft::{DataKey as RemittanceDataKey, RemittanceMetadata, RemittanceNFT, RemittanceNFTClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, BytesN, Env, Symbol, IntoVal, Val};
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
    AuthorizeMinter {
        minter_id: u8,
    },
    RevokeMinter {
        minter_id: u8,
    },
    Mint {
        user_id: u8,
        initial_score: u32,
        minter_id: Option<u8>,
    },
    UpdateScore {
        user_id: u8,
        repayment_amount: i128,
        minter_id: Option<u8>,
    },
    UpdateHistoryHash {
        user_id: u8,
        minter_id: Option<u8>,
    },
    LegacyMigration {
        user_id: u8,
        legacy_score: u32,
    },
    MultipleOperations {
        operations: Vec<NFTOperation>,
    },
}

#[derive(Arbitrary, Debug)]
struct NFTOperation {
    user_id: u8,
    minter_id: Option<u8>,
    score: u32,
    amount: i128,
    operation_type: u8, // 0: mint, 1: update_score, 2: update_history_hash, 3: revoke_minter
}

fuzz_target!(|data: FuzzAction| {
    let env = Env::default();
    env.mock_all_auths();

    // 1. Setup RemittanceNFT
    let nft_id = env.register(RemittanceNFT, ());
    let nft_client = RemittanceNFTClient::new(&env, &nft_id);
    let admin = Address::generate(&env);
    nft_client.initialize(&admin);

    match data {
        FuzzAction::AuthorizeMinter { minter_id } => {
            let minter = Address::generate(&env);

            let result = rcall!(&env, nft_client, "authorize_minter", (minter));

            if result.is_ok() {
                // Verify invariant: minter should be authorized
                assert!(
                    nft_client.is_authorized_minter(&minter),
                    "Minter should be authorized after authorization"
                );
            }
        }

        FuzzAction::RevokeMinter { minter_id } => {
            let minter = Address::generate(&env);

            // First authorize, then revoke
            nft_client.authorize_minter(&minter);

            let result = rcall!(&env, nft_client, "revoke_minter", (minter));

            if result.is_ok() {
                // Verify invariant: minter should not be authorized
                assert!(
                    !nft_client.is_authorized_minter(&minter),
                    "Minter should not be authorized after revocation"
                );
            }
        }

        FuzzAction::Mint {
            user_id,
            initial_score,
            minter_id,
        } => {
            let user = Address::generate(&env);
            let minter = minter_id.map(|_| Address::generate(&env));
            let history_hash = BytesN::from_array(&env, &[0u8; 32]);

            if let Some(ref m) = minter {
                nft_client.authorize_minter(m);
            }

            let result = rcall!(&env, nft_client, "mint", (user, initial_score, history_hash, minter));

            if result.is_ok() {
                // Verify invariant: user should have metadata
                let metadata = nft_client.get_metadata(&user);
                assert!(
                    metadata.is_some(),
                    "User should have metadata after minting"
                );

                if let Some(md) = metadata {
                    assert_eq!(md.score, initial_score, "Score should match initial score");
                }

                // Verify invariant: duplicate mint should fail
                let result = rcall!(&env, nft_client, "mint", (user, initial_score, history_hash, minter));
                assert!(result.is_err(), "Duplicate mint should fail");
            }
        }

        FuzzAction::UpdateScore {
            user_id,
            repayment_amount,
            minter_id,
        } => {
            let user = Address::generate(&env);
            let minter = minter_id.map(|_| Address::generate(&env));

            // First mint an NFT for the user
            let history_hash = BytesN::from_array(&env, &[0u8; 32]);
            nft_client.mint(&user, &100, &history_hash, &None);

            if let Some(ref m) = minter {
                nft_client.authorize_minter(m);
            }

            let score_before = nft_client.get_score(&user);
            let result = rcall!(&env, nft_client, "update_score", (user, repayment_amount, minter));

            if result.is_ok() {
                let score_after = nft_client.get_score(&user);

                // Verify invariant: score should increase with positive repayment
                if repayment_amount >= 100 {
                    assert!(
                        score_after >= score_before,
                        "Score should increase or stay same with positive repayment"
                    );
                }

                // Verify invariant: score should never be negative
                assert!(score_after >= 0, "Score should never be negative");
            }
        }

        FuzzAction::UpdateHistoryHash { user_id, minter_id } => {
            let user = Address::generate(&env);
            let minter = minter_id.map(|_| Address::generate(&env));
            let new_history_hash = BytesN::from_array(&env, &[1u8; 32]);

            // First mint an NFT for the user
            let history_hash = BytesN::from_array(&env, &[0u8; 32]);
            nft_client.mint(&user, &100, &history_hash, &None);

            if let Some(ref m) = minter {
                nft_client.authorize_minter(m);
            }

            let result = rcall!(&env, nft_client, "update_history_hash", (user, new_history_hash, minter));

            if result.is_ok() {
                // Verify invariant: history hash should be updated
                let metadata = nft_client.get_metadata(&user).unwrap();
                assert_eq!(
                    metadata.history_hash, new_history_hash,
                    "History hash should be updated"
                );
            }
        }

        FuzzAction::LegacyMigration { user_id, legacy_score } => {
            let user = Address::generate(&env);
            
            // Manually set legacy score in storage
            // In a real scenario, this would be done by an older version of the contract
            // We use the same DataKey enum but setter might be different if we were external
            // But here we are testing the contract's ability to read old keys
            
            // We need to know the exact key format. In lib.rs: Score(Address)
            // Since we're in the same crate (via dependency), we can try to use it if public
            // or just mock the storage if we have access to Env test utils
            
            env.as_contract(&nft_id, || {
                env.storage().persistent().set(&(RemittanceDataKey::Score(user.clone())), &legacy_score);
            });
            
            let score = nft_client.get_score(&user);
            assert_eq!(score, legacy_score, "Should correctly read legacy score");
            
            // Getting metadata should trigger migration
            let metadata = nft_client.get_metadata(&user).unwrap();
            assert_eq!(metadata.score, legacy_score, "Metadata score should match legacy score");
            
            // Legacy key should be removed
            env.as_contract(&nft_id, || {
                assert!(!env.storage().persistent().has(&(RemittanceDataKey::Score(user.clone()))), "Legacy key should be removed after migration");
            });
        }

        FuzzAction::MultipleOperations { operations } => {
            let mut users = HashMap::new();
            let mut minters = HashMap::new();

            for op in operations {
                let user_addr = users.entry(op.user_id).or_insert_with(|| Address::generate(&env)).clone();
                let minter_addr = op.minter_id.map(|id| {
                    minters.entry(id).or_insert_with(|| {
                        let addr = Address::generate(&env);
                        nft_client.authorize_minter(&addr);
                        addr
                    }).clone()
                });

                match op.operation_type % 4 {
                    0 => {
                        // Mint
                        let history_hash = BytesN::from_array(&env, &[0u8; 32]);
                        let _ = rcall!(&env, nft_client, "mint", (user_addr, op.score, history_hash, minter_addr));
                    }
                    1 => {
                        // Update score
                        let _ = rcall!(&env, nft_client, "update_score", (user_addr, op.amount, minter_addr));
                    }
                    2 => {
                        // Update history hash
                        let new_history_hash = BytesN::from_array(&env, &[op.operation_type; 32]);
                        let _ = rcall!(&env, nft_client, "update_history_hash", (user_addr, new_history_hash, minter_addr));
                    }
                    3 => {
                        // Revoke minter
                        if let Some(ref m) = minter_addr {
                            let _ = rcall!(&env, nft_client, "revoke_minter", (m));
                        }
                    }
                    _ => {}
                }
            }
        }
    }
});

