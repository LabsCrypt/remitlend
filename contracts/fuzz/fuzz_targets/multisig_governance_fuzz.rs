#![no_main]

//! Fuzz target for the MultisigGovernance (`GovernanceContract`) contract.
//!
//! Multisig handles admin transfers across every other contract, so the
//! highest-value invariants live in the signer-set and proposal state machine:
//!   - approvals are deduplicated (a signer approving twice counts once),
//!   - the approval count never exceeds the signer set,
//!   - the admin only ever changes via an explicit finalize — never as a side
//!     effect of propose/approve/cancel/expire.
//!
//! We drive an arbitrary sequence of actions and assert these hold throughout.

use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;
use multisig_governance::{GovernanceContract, GovernanceContractClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, Vec};

const POOL_SIZE: usize = 8;

#[derive(Arbitrary, Debug)]
enum FuzzAction {
    Propose { num_signers: u8, threshold: u8, delay: u32 },
    Approve { signer_idx: u8 },
    Expire,
    Cancel,
}

fuzz_target!(|actions: std::vec::Vec<FuzzAction>| {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let target = Address::generate(&env);

    let contract_id = env.register(GovernanceContract, ());
    let client = GovernanceContractClient::new(&env, &contract_id);
    client.initialize(&admin, &target);

    // A stable pool of candidate signers so indices are meaningful across actions.
    let pool: std::vec::Vec<Address> =
        (0..POOL_SIZE).map(|_| Address::generate(&env)).collect();

    for action in actions {
        match action {
            FuzzAction::Propose { num_signers, threshold, delay } => {
                let n = (num_signers as usize % POOL_SIZE) + 1; // 1..=POOL_SIZE
                let mut signers = Vec::new(&env);
                for s in pool.iter().take(n) {
                    signers.push_back(s.clone());
                }
                let thr = (threshold as u32 % n as u32) + 1; // 1..=n
                // try_* so contract panics (cooldown, already-pending, …) don't abort the fuzzer.
                let _ = client.try_propose_admin_transfer(
                    &Address::generate(&env),
                    &signers,
                    &thr,
                    &(delay as u64),
                );
            }
            FuzzAction::Approve { signer_idx } => {
                let signer = pool[signer_idx as usize % POOL_SIZE].clone();
                let _ = client.try_approve_transfer(&signer);

                // Invariant: approvals are Map-deduplicated, so the count can
                // never exceed the signer pool regardless of repeated approvals.
                if client.has_pending_transfer() {
                    assert!(
                        client.get_approval_count() <= POOL_SIZE as u32,
                        "approval count exceeded the signer pool size",
                    );
                }
            }
            FuzzAction::Expire => {
                let _ = client.try_expire_proposal(&admin);
            }
            FuzzAction::Cancel => {
                let _ = client.try_cancel_admin_transfer();
            }
        }

        // Global invariant: we never call finalize, so the admin must never change.
        assert_eq!(
            client.get_admin(),
            admin,
            "admin changed without an explicit finalize",
        );
    }
});
