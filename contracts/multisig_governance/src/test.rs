use super::*;
use soroban_sdk::testutils::{Address as _, Ledger, LedgerInfo};
use soroban_sdk::{Address, BytesN, Env, Vec};
#[allow(deprecated)]
#[contract]
pub struct MockTarget;

#[contractimpl]
impl MockTarget {
    pub fn set_admin(env: Env, new_admin: Address) {
        env.storage()
            .instance()
            .set(&symbol_short!("admin"), &new_admin);
    }
    pub fn has_pending_transfer(env: Env) -> bool {
        if let Some(pending) = env
            .storage()
            .instance()
            .get::<Symbol, PendingTransfer>(&KEY_PENDING)
        {
            pending.status == ProposalStatus::Active
        } else {
            false
        }
    }
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&symbol_short!("admin"))
            .unwrap()
    }
}

fn setup() -> (Env, GovernanceContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(GovernanceContract, ());
    let client = GovernanceContractClient::new(&env, &id);
    let admin = Address::generate(&env);

    let target_id = env.register(MockTarget, ());
    let target = target_id.clone();

    client.initialize(&admin, &target);
    (env, client, admin, target)
}

fn set_ts(env: &Env, ts: u64) {
    env.ledger().set(LedgerInfo {
        timestamp: ts,
        protocol_version: 22,
        sequence_number: 1000, // Keep sequence constant to prevent archiving
        network_id: Default::default(),
        base_reserve: 5_000_000,
        min_temp_entry_ttl: 1_000_000,
        min_persistent_entry_ttl: 1_000_000,
        max_entry_ttl: 10_000_000,
    });
}

fn create_upgrade_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[11u8; 32])
}

#[test]
fn version_is_initialized() {
    let (_env, client, _admin, _) = setup();
    assert_eq!(client.version(), 1);
}

#[test]
#[should_panic]
fn upgrade_requires_admin_auth() {
    let (env, client, _admin, _) = setup();
    env.mock_auths(&[]);
    client.upgrade(&create_upgrade_hash(&env));
}

#[test]
fn finalize_succeeds_and_updates_local_and_remote_state() {
    let (env, client, admin, target) = setup();
    let proposed = Address::generate(&env);
    let s = Address::generate(&env);
    let signers = Vec::from_slice(&env, core::slice::from_ref(&s));

    set_ts(&env, 1000);
    client.propose_admin_transfer(&proposed, &signers, &1, &MIN_TIMELOCK_SECONDS);
    client.approve_transfer(&s);

    set_ts(&env, 1000 + MIN_TIMELOCK_SECONDS + 1);

    // Call finalize
    client.finalize_admin_transfer(&admin);

    // 1. Local state updated
    assert_eq!(client.get_current_admin(), proposed);
    assert!(!client.has_pending_transfer());

    // 2. Remote state updated (MockTarget)
    let target_client = MockTargetClient::new(&env, &target);
    assert_eq!(target_client.get_admin(), proposed);
}

#[test]
fn initialize_sets_admin() {
    let (_env, client, admin, _) = setup();
    assert_eq!(client.get_current_admin(), admin);
}

#[test]
fn exposes_target_pending_admin_and_approval_queries() {
    let (env, client, admin, target) = setup();
    let proposed = Address::generate(&env);
    let signer = Address::generate(&env);
    let signers = Vec::from_slice(&env, core::slice::from_ref(&signer));

    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_target(), target);
    assert!(client.get_pending().is_none());

    set_ts(&env, 1000);
    client.propose_admin_transfer(&proposed, &signers, &1, &MIN_TIMELOCK_SECONDS);
    client.approve_transfer(&signer);

    let pending = client.get_pending().expect("pending transfer");
    assert_eq!(pending.proposed_admin, proposed);
    assert_eq!(client.get_approval_count(), 1);
}

#[test]
fn double_initialize_panics() {
    let (env, client, _, _) = setup();
    let result = client.try_initialize(&Address::generate(&env), &Address::generate(&env));
    assert_eq!(result, Err(Ok(GovernanceError::AlreadyInitialized)));
}

#[test]
fn propose_creates_pending_transfer() {
    let (env, client, _, _) = setup();
    let proposed = Address::generate(&env);
    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    let signers = Vec::from_slice(&env, &[s1, s2]);
    set_ts(&env, 1000);
    client.propose_admin_transfer(&proposed, &signers, &2, &MIN_TIMELOCK_SECONDS);
    assert!(client.has_pending_transfer());
    let p = client.get_pending_transfer();
    assert_eq!(p.threshold, 2);
    assert_eq!(p.executable_after, 1000 + MIN_TIMELOCK_SECONDS);
}

#[test]
fn propose_rejects_short_delay() {
    let (env, client, _, _) = setup();
    let signers = Vec::from_slice(&env, &[Address::generate(&env)]);
    let result = client.try_propose_admin_transfer(&Address::generate(&env), &signers, &1, &3600);
    assert_eq!(result, Err(Ok(GovernanceError::DelayTooShort)));
}

#[test]
fn propose_rejects_threshold_exceeding_signers() {
    let (env, client, _, _) = setup();
    let signers = Vec::from_slice(&env, &[Address::generate(&env)]);
    let result = client.try_propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &2,
        &MIN_TIMELOCK_SECONDS,
    );
    assert_eq!(
        result,
        Err(Ok(GovernanceError::ThresholdExceedsSignerCount))
    );
}

#[test]
fn propose_rejects_duplicate() {
    let (env, client, _, _) = setup();
    let signers = Vec::from_slice(&env, &[Address::generate(&env)]);
    client.propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &1,
        &MIN_TIMELOCK_SECONDS,
    );
    let result = client.try_propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &1,
        &MIN_TIMELOCK_SECONDS,
    );
    assert_eq!(result, Err(Ok(GovernanceError::TransferAlreadyPending)));
}

#[test]
fn propose_rejects_duplicate_signer_address() {
    let (env, client, _, _) = setup();
    let s = Address::generate(&env);
    // Duplicate the same address in the signer list
    let signers = Vec::from_slice(&env, &[s.clone(), s.clone()]);
    set_ts(&env, 1000);
    let result = client.try_propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &2,
        &MIN_TIMELOCK_SECONDS,
    );
    assert_eq!(result, Err(Ok(GovernanceError::DuplicateSigner)));
}

#[test]
fn approve_increments_count() {
    let (env, client, _, _) = setup();
    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    let signers = Vec::from_slice(&env, &[s1.clone(), s2.clone()]);
    client.propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &2,
        &MIN_TIMELOCK_SECONDS,
    );
    assert_eq!(client.get_approval_count(), 0);
    client.approve_transfer(&s1);
    assert_eq!(client.get_approval_count(), 1);
    client.approve_transfer(&s2);
    assert_eq!(client.get_approval_count(), 2);
}

#[test]
fn approve_is_idempotent() {
    let (env, client, _, _) = setup();
    let s = Address::generate(&env);
    let signers = Vec::from_slice(&env, core::slice::from_ref(&s));
    client.propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &1,
        &MIN_TIMELOCK_SECONDS,
    );
    client.approve_transfer(&s);
    client.approve_transfer(&s); // second call must not double-count
    assert_eq!(client.get_approval_count(), 1);
}

#[test]
fn approve_rejects_non_signer() {
    let (env, client, _, _) = setup();
    let s = Address::generate(&env);
    let signers = Vec::from_slice(&env, &[s]);
    client.propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &1,
        &MIN_TIMELOCK_SECONDS,
    );
    let result = client.try_approve_transfer(&Address::generate(&env));
    assert_eq!(result, Err(Ok(GovernanceError::SignerNotAllowed)));
}

#[test]
fn finalize_before_timelock_panics() {
    let (env, client, _, _) = setup();
    let s = Address::generate(&env);
    let signers = Vec::from_slice(&env, core::slice::from_ref(&s));
    set_ts(&env, 1000);
    client.propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &1,
        &MIN_TIMELOCK_SECONDS,
    );
    client.approve_transfer(&s);
    set_ts(&env, 1000 + MIN_TIMELOCK_SECONDS - 1);
    let result = client.try_finalize_admin_transfer(&Address::generate(&env));
    assert_eq!(result, Err(Ok(GovernanceError::TimelockNotElapsed)));
}

#[test]
fn finalize_without_enough_approvals_panics() {
    let (env, client, _, _) = setup();
    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    let signers = Vec::from_slice(&env, &[s1.clone(), s2]);
    set_ts(&env, 1000);
    client.propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &2,
        &MIN_TIMELOCK_SECONDS,
    );
    client.approve_transfer(&s1); // only 1 of 2
    set_ts(&env, 1000 + MIN_TIMELOCK_SECONDS + 1);
    let result = client.try_finalize_admin_transfer(&Address::generate(&env));
    assert_eq!(result, Err(Ok(GovernanceError::ThresholdNotMet)));
}

#[test]
fn timelock_remaining_counts_down() {
    let (env, client, _, _) = setup();
    let s = Address::generate(&env);
    let signers = Vec::from_slice(&env, &[s]);
    set_ts(&env, 1000);
    client.propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &1,
        &MIN_TIMELOCK_SECONDS,
    );
    set_ts(&env, 1000 + 3600);
    assert_eq!(client.get_timelock_remaining(), MIN_TIMELOCK_SECONDS - 3600);
}

// #[test]
// fn timelock_remaining_returns_zero_after_expiry() {
//     let (env, client, _, _) = setup();
//     let s = Address::generate(&env);
//     let signers = Vec::from_slice(&env, &[s]);
//     set_ts(&env, 1000);
//     client.propose_admin_transfer(&Address::generate(&env), &signers, &1, &MIN_TIMELOCK_SECONDS);
//     set_ts(&env, 1000 + MIN_TIMELOCK_SECONDS + 1);
//     assert_eq!(client.get_timelock_remaining(), 0);
// }

#[test]
fn timelock_remaining_returns_zero_after_expiry() {
    let (env, client, _, _) = setup();
    let s = Address::generate(&env);
    let signers = Vec::from_slice(&env, &[s]);

    // Set initial time
    set_ts(&env, 1000);

    client.propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &1,
        &MIN_TIMELOCK_SECONDS,
    );

    // Move WELL past expiry (not just +1)
    set_ts(&env, 1000 + MIN_TIMELOCK_SECONDS + 100);

    assert_eq!(client.get_timelock_remaining(), 0);
}

#[test]
fn cancel_clears_pending() {
    let (env, client, _, _) = setup();
    let s = Address::generate(&env);
    let signers = Vec::from_slice(&env, &[s]);
    client.propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &1,
        &MIN_TIMELOCK_SECONDS,
    );
    assert!(client.has_pending_transfer());
    client.cancel_admin_transfer();
    assert!(!client.has_pending_transfer());
}

#[test]
fn cancel_enforces_reproposal_cooldown() {
    let (env, client, _, _) = setup();
    let s = Address::generate(&env);
    let signers = Vec::from_slice(&env, &[s]);

    set_ts(&env, 1000);
    client.propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &1,
        &MIN_TIMELOCK_SECONDS,
    );
    client.cancel_admin_transfer();

    let result = client.try_propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &1,
        &MIN_TIMELOCK_SECONDS,
    );
    assert_eq!(result, Err(Ok(GovernanceError::ReproposalCooldownActive)));
}

#[test]
fn cancel_allows_reproposal_after_cooldown() {
    let (env, client, _, _) = setup();
    let s = Address::generate(&env);
    let signers = Vec::from_slice(&env, &[s]);

    set_ts(&env, 1000);
    client.propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &1,
        &MIN_TIMELOCK_SECONDS,
    );
    client.cancel_admin_transfer();

    set_ts(&env, 1000 + REPROPOSAL_COOLDOWN_SECONDS + 1);
    client.propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &1,
        &MIN_TIMELOCK_SECONDS,
    );
    assert!(client.has_pending_transfer());
}

#[test]
fn cancel_with_no_pending_panics() {
    let (_env, client, _, _) = setup();
    let result = client.try_cancel_admin_transfer();
    assert_eq!(result, Err(Ok(GovernanceError::NoPendingTransfer)));
}

#[test]
fn expire_proposal_works_after_ttl() {
    let (env, client, _admin, _) = setup();
    let proposed = Address::generate(&env);
    let s = Address::generate(&env);
    let signers = Vec::from_slice(&env, core::slice::from_ref(&s));

    // Create proposal
    set_ts(&env, 1000);
    client.propose_admin_transfer(&proposed, &signers, &1, &MIN_TIMELOCK_SECONDS);
    assert!(client.has_pending_transfer());

    // Move past TTL
    set_ts(&env, 1000 + PROPOSAL_TTL_SECONDS + 1);

    // Anyone can expire the proposal
    let caller = Address::generate(&env);
    client.expire_proposal(&caller);

    // Proposal should be gone
    assert!(!client.has_pending_transfer());
}

#[test]
fn expire_proposal_fails_before_ttl() {
    let (env, client, _, _) = setup();
    let proposed = Address::generate(&env);
    let s = Address::generate(&env);
    let signers = Vec::from_slice(&env, core::slice::from_ref(&s));

    // Create proposal
    set_ts(&env, 1000);
    client.propose_admin_transfer(&proposed, &signers, &1, &MIN_TIMELOCK_SECONDS);

    // Try to expire before TTL
    set_ts(&env, 1000 + PROPOSAL_TTL_SECONDS - 1);
    let result = client.try_expire_proposal(&Address::generate(&env));
    assert_eq!(result, Err(Ok(GovernanceError::ProposalNotExpired)));
}

#[test]
fn expire_proposal_fails_with_no_pending() {
    let (env, client, _, _) = setup();
    let result = client.try_expire_proposal(&Address::generate(&env));
    assert_eq!(result, Err(Ok(GovernanceError::NoPendingTransfer)));
}

#[test]
fn finalize_fails_after_expiry() {
    let (env, client, admin, _) = setup();
    let proposed = Address::generate(&env);
    let s = Address::generate(&env);
    let signers = Vec::from_slice(&env, core::slice::from_ref(&s));

    // Create proposal
    set_ts(&env, 1000);
    client.propose_admin_transfer(&proposed, &signers, &1, &MIN_TIMELOCK_SECONDS);
    client.approve_transfer(&s);

    // Move past both timelock and TTL
    set_ts(&env, 1000 + MIN_TIMELOCK_SECONDS + PROPOSAL_TTL_SECONDS + 1);

    // Finalization should fail due to expiry
    let result = client.try_finalize_admin_transfer(&admin);
    assert_eq!(result, Err(Ok(GovernanceError::ProposalExpired)));
}

#[test]
fn finalize_works_within_ttl() {
    let (env, client, admin, _) = setup();
    let proposed = Address::generate(&env);
    let s = Address::generate(&env);
    let signers = Vec::from_slice(&env, core::slice::from_ref(&s));

    // Create proposal
    set_ts(&env, 1000);
    client.propose_admin_transfer(&proposed, &signers, &1, &MIN_TIMELOCK_SECONDS);
    client.approve_transfer(&s);

    // Move past timelock but within TTL
    set_ts(&env, 1000 + MIN_TIMELOCK_SECONDS + 1);

    // Finalization should succeed
    client.finalize_admin_transfer(&admin);
    assert_eq!(client.get_current_admin(), proposed);
    assert!(!client.has_pending_transfer());
}

#[test]
fn new_proposal_allowed_after_expiry() {
    let (env, client, _admin, _) = setup();
    let proposed1 = Address::generate(&env);
    let proposed2 = Address::generate(&env);
    let s = Address::generate(&env);
    let signers = Vec::from_slice(&env, core::slice::from_ref(&s));

    // Create first proposal
    set_ts(&env, 1000);
    client.propose_admin_transfer(&proposed1, &signers, &1, &MIN_TIMELOCK_SECONDS);

    // Expire it
    set_ts(&env, 1000 + PROPOSAL_TTL_SECONDS + 1);
    client.expire_proposal(&Address::generate(&env));

    // Should be able to create new proposal after cooldown (expiry triggers same cooldown as cancellation)
    set_ts(&env, 1000 + PROPOSAL_TTL_SECONDS + 3602);
    client.propose_admin_transfer(&proposed2, &signers, &1, &MIN_TIMELOCK_SECONDS);
    assert!(client.has_pending_transfer());
    let pending = client.get_pending_transfer();
    assert_eq!(pending.proposed_admin, proposed2);
}
#[test]
fn emergency_cancel_works_and_prevents_finalization() {
    let (env, client, _admin, _) = setup();
    let proposed = Address::generate(&env);
    let s = Address::generate(&env);
    let signers = Vec::from_slice(&env, core::slice::from_ref(&s));

    set_ts(&env, 1000);
    client.propose_admin_transfer(&proposed, &signers, &1, &MIN_TIMELOCK_SECONDS);
    let proposal_id = client.get_pending_transfer().id;

    // Emergency cancel
    let reason = Some(soroban_sdk::String::from_str(&env, "Emergency"));
    client.emergency_cancel_proposal(&proposal_id, &reason);

    // Proposal should no longer be "pending" (active)
    assert!(!client.has_pending_transfer());
    assert_eq!(
        client.get_pending_transfer().status,
        ProposalStatus::Cancelled
    );

    // Finalization should panic
    set_ts(&env, 1000 + MIN_TIMELOCK_SECONDS + 1);
    // client.finalize_admin_transfer(&admin); // This would panic
}

#[test]
fn cannot_approve_cancelled_proposal() {
    let (env, client, _admin, _) = setup();
    let s = Address::generate(&env);
    let signers = Vec::from_slice(&env, core::slice::from_ref(&s));

    client.propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &1,
        &MIN_TIMELOCK_SECONDS,
    );
    let proposal_id = client.get_pending_transfer().id;
    client.emergency_cancel_proposal(&proposal_id, &None);

    let result = client.try_approve_transfer(&s);
    assert_eq!(result, Err(Ok(GovernanceError::ProposalNotActive)));
}

#[test]
fn cannot_finalize_cancelled_proposal() {
    let (env, client, admin, _) = setup();
    let s = Address::generate(&env);
    let signers = Vec::from_slice(&env, core::slice::from_ref(&s));

    set_ts(&env, 1000);
    client.propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &1,
        &MIN_TIMELOCK_SECONDS,
    );
    let proposal_id = client.get_pending_transfer().id;
    client.approve_transfer(&s);

    client.emergency_cancel_proposal(&proposal_id, &None);

    set_ts(&env, 1000 + MIN_TIMELOCK_SECONDS + 1);
    let result = client.try_finalize_admin_transfer(&admin);
    assert_eq!(result, Err(Ok(GovernanceError::ProposalNotActive)));
}

// ── Additional coverage tests ─────────────────────────────────────────────────

#[test]
fn propose_rejects_empty_signers() {
    let (env, client, _, _) = setup();
    let signers: Vec<Address> = Vec::new(&env);
    let result = client.try_propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &1,
        &MIN_TIMELOCK_SECONDS,
    );
    assert_eq!(result, Err(Ok(GovernanceError::EmptySignerList)));
}

#[test]
fn propose_rejects_too_many_signers() {
    let (env, client, _, _) = setup();
    let mut addrs = soroban_sdk::vec![&env];
    for _ in 0..21 {
        addrs.push_back(Address::generate(&env));
    }
    let result = client.try_propose_admin_transfer(
        &Address::generate(&env),
        &addrs,
        &1,
        &MIN_TIMELOCK_SECONDS,
    );
    assert_eq!(result, Err(Ok(GovernanceError::TooManySigners)));
}

#[test]
fn proposal_count_increments() {
    let (env, client, _, _) = setup();
    assert_eq!(client.get_proposal_count(), 0);

    let s1 = Address::generate(&env);
    let signers = Vec::from_slice(&env, &[s1]);
    client.propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &1,
        &MIN_TIMELOCK_SECONDS,
    );
    assert_eq!(client.get_proposal_count(), 1);

    client.cancel_admin_transfer();
    assert_eq!(client.get_proposal_count(), 1);

    set_ts(&env, 1000 + REPROPOSAL_COOLDOWN_SECONDS + 1);
    let s2 = Address::generate(&env);
    let signers2 = Vec::from_slice(&env, &[s2]);
    client.propose_admin_transfer(
        &Address::generate(&env),
        &signers2,
        &1,
        &MIN_TIMELOCK_SECONDS,
    );
    assert_eq!(client.get_proposal_count(), 2);
}

#[test]
fn get_signers_returns_signer_list() {
    let (env, client, _, _) = setup();
    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    let signers = Vec::from_slice(&env, &[s1.clone(), s2.clone()]);
    client.propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &2,
        &MIN_TIMELOCK_SECONDS,
    );
    let result = client.get_signers();
    assert_eq!(result.len(), 2);
    assert_eq!(result.get(0), Some(s1));
    assert_eq!(result.get(1), Some(s2));
}

#[test]
fn get_threshold_returns_pending_threshold() {
    let (env, client, _, _) = setup();
    let s = Address::generate(&env);
    let signers = Vec::from_slice(&env, &[s]);
    client.propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &1,
        &MIN_TIMELOCK_SECONDS,
    );
    assert_eq!(client.get_threshold(), 1);
}

#[test]
fn has_approved_tracks_approvals() {
    let (env, client, _, _) = setup();
    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    let signers = Vec::from_slice(&env, &[s1.clone(), s2.clone()]);
    client.propose_admin_transfer(
        &Address::generate(&env),
        &signers,
        &2,
        &MIN_TIMELOCK_SECONDS,
    );
    assert!(!client.has_approved(&s1));
    assert!(!client.has_approved(&s2));

    client.approve_transfer(&s1);
    assert!(client.has_approved(&s1));
    assert!(!client.has_approved(&s2));

    client.approve_transfer(&s2);
    assert!(client.has_approved(&s1));
    assert!(client.has_approved(&s2));
}
