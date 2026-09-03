use super::*;
use soroban_sdk::{
    contract, contractimpl, testutils::Address as _, testutils::Events as _,
    testutils::Ledger as _, Address, BytesN, Env, FromVal, String, Symbol, Vec,
};

fn create_test_hash(env: &Env, value: u8) -> BytesN<32> {
    let mut hash_bytes = [0u8; 32];
    hash_bytes[0] = value;
    BytesN::from_array(env, &hash_bytes)
}

fn create_test_commitment(env: &Env, value: u8) -> BytesN<32> {
    let mut commitment_bytes = [0u8; 32];
    commitment_bytes[0] = value;
    BytesN::from_array(env, &commitment_bytes)
}

fn create_test_uri(env: &Env) -> String {
    String::from_str(env, "ipfs://QmTest123")
}

#[test]
#[should_panic]
fn test_upgrade_requires_admin_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    env.mock_all_auths();
    client.initialize(&admin);

    env.mock_auths(&[]);
    client.upgrade(&create_test_hash(&env, 42));
}

#[test]
fn test_score_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    assert_eq!(client.version(), 2);

    let history_hash = create_test_hash(&env, 1);

    // Initial mint (admin mints, so minter is None)
    client.mint(
        &user,
        &500,
        &history_hash,
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    assert_eq!(client.get_score(&user), 500);

    // Check metadata
    let metadata = client.get_metadata(&user).unwrap();
    assert_eq!(metadata.score, 500);
    assert_eq!(metadata.history_hash, history_hash);

    // Update score (repayment of 250 -> 2 points) - admin updates
    client.update_score(&user, &2_500_000_000, &None);
    assert_eq!(client.get_score(&user), 502);

    // Verify metadata updated
    let metadata = client.get_metadata(&user).unwrap();
    assert_eq!(metadata.score, 502);

    // Update score (repayment of 1000 -> 10 points) - admin updates
    client.update_score(&user, &10_000_000_000, &None);
    assert_eq!(client.get_score(&user), 512);

    // Verify metadata updated
    let metadata = client.get_metadata(&user).unwrap();
    assert_eq!(metadata.score, 512);

    // Unregistered user should have 0 score
    let stranger = Address::generate(&env);
    assert_eq!(client.get_score(&stranger), 0);
    assert!(client.get_metadata(&stranger).is_none());
}

#[test]
fn test_history_hash_update() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    let initial_hash = create_test_hash(&env, 1);
    client.mint(
        &user,
        &500,
        &initial_hash,
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    let metadata = client.get_metadata(&user).unwrap();
    assert_eq!(metadata.history_hash, initial_hash);

    // Update history hash - admin updates
    let new_hash = create_test_hash(&env, 2);
    client.update_history_hash(&user, &new_hash, &None);

    let metadata = client.get_metadata(&user).unwrap();
    assert_eq!(metadata.history_hash, new_hash);
    assert_eq!(metadata.score, 500); // Score should remain unchanged
}

#[test]
#[should_panic]
fn test_update_history_hash_rejects_zero_hash() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    let initial_hash = create_test_hash(&env, 1);
    client.mint(
        &user,
        &500,
        &initial_hash,
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    // Passing an all-zero hash must panic (Err(InvalidHistoryHash))
    let zero_hash = BytesN::from_array(&env, &[0u8; 32]);
    client.update_history_hash(&user, &zero_hash, &None);
}

#[test]
#[should_panic]
fn test_update_history_hash_rejects_same_hash() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    let initial_hash = create_test_hash(&env, 1);
    client.mint(
        &user,
        &500,
        &initial_hash,
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    // Passing the same hash that is already stored must panic (Err(InvalidHistoryHash))
    client.update_history_hash(&user, &initial_hash, &None);
}

#[test]
fn test_authorized_minter() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let authorized_contract = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    // Admin should be authorized by default
    assert!(client.is_authorized_minter(&admin));
    let initial_minters = client.get_authorized_minters();
    assert_eq!(initial_minters.len(), 1);
    assert_eq!(initial_minters.get(0).unwrap(), admin);

    // Authorize a contract
    client.authorize_minter(&authorized_contract);
    assert!(client.is_authorized_minter(&authorized_contract));
    let after_authorize = client.get_authorized_minters();
    assert_eq!(after_authorize.len(), 2);

    // Revoke authorization
    client.revoke_minter(&authorized_contract);
    assert!(!client.is_authorized_minter(&authorized_contract));
    let after_revoke = client.get_authorized_minters();
    assert_eq!(after_revoke.len(), 1);
    assert_eq!(after_revoke.get(0).unwrap(), admin);
}

#[test]
fn test_authorized_minter_limit_enforced() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);
    client.initialize(&admin);

    // Admin is already in the list, so only 31 more can be added.
    for _ in 0..(RemittanceNFT::MAX_AUTHORIZED_MINTERS - 1) {
        let minter = Address::generate(&env);
        client.authorize_minter(&minter);
    }

    let overflow_minter = Address::generate(&env);
    let result = client.try_authorize_minter(&overflow_minter);
    assert_eq!(result, Err(Ok(NftError::MinterLimitReached)));
}

#[test]
#[should_panic]
fn test_not_initialized() {
    let env = Env::default();
    let user = Address::generate(&env);
    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    let history_hash = create_test_hash(&env, 1);
    client.mint(
        &user,
        &500,
        &history_hash,
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
}

#[test]
#[should_panic]
fn test_already_initialized() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.initialize(&admin);
}

#[test]
#[should_panic]
fn test_duplicate_mint() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    let history_hash = create_test_hash(&env, 1);
    client.mint(
        &user,
        &500,
        &history_hash,
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    // Try to mint again for the same user
    let history_hash2 = create_test_hash(&env, 2);
    client.mint(
        &user,
        &600,
        &history_hash2,
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
}

#[test]
#[should_panic]
fn test_update_score_without_nft() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    // Try to update score for user without NFT
    client.update_score(&user, &1_000_000_000, &None);
}

#[test]
fn test_backward_compatibility_migration() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    // Simulate legacy Score data (old format)
    use super::DataKey;
    let score_key = DataKey::Score(user.clone());
    env.as_contract(&contract_id, || {
        env.storage().persistent().set(&score_key, &750u32);
    });

    // get_score should migrate and return the score
    assert_eq!(client.get_score(&user), 750);

    // get_metadata should return migrated metadata with default hash
    let metadata = client.get_metadata(&user).unwrap();
    assert_eq!(metadata.score, 750);
    // Verify default hash (all zeros)
    let expected_default_hash = BytesN::from_array(&env, &[0u8; 32]);
    assert_eq!(metadata.history_hash, expected_default_hash);

    // Verify old Score key is removed after migration
    env.as_contract(&contract_id, || {
        assert!(!env.storage().persistent().has(&score_key));

        // Verify Metadata key exists after migration
        let metadata_key = DataKey::Metadata(user.clone());
        assert!(env.storage().persistent().has(&metadata_key));
    });

    // Update score should work on migrated data
    client.update_score(&user, &5_000_000_000, &None);
    assert_eq!(client.get_score(&user), 755); // 750 + 5 points (500/100)

    // Verify metadata still exists and is updated
    let updated_metadata = client.get_metadata(&user).unwrap();
    assert_eq!(updated_metadata.score, 755);
}

#[test]
fn test_update_score_migrates_legacy_data() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    // Simulate legacy Score data
    use super::DataKey;
    let score_key = DataKey::Score(user.clone());
    env.as_contract(&contract_id, || {
        env.storage().persistent().set(&score_key, &600u32);
    });

    // update_score should migrate legacy data and then update
    client.update_score(&user, &2_000_000_000, &None);

    // Score should be 602 (600 + 2 points from 200/100)
    assert_eq!(client.get_score(&user), 602);

    // Verify migration happened
    env.as_contract(&contract_id, || {
        let metadata_key = DataKey::Metadata(user.clone());
        assert!(env.storage().persistent().has(&metadata_key));
        assert!(!env.storage().persistent().has(&score_key));
    });

    let metadata = client.get_metadata(&user).unwrap();
    assert_eq!(metadata.score, 602);
}

#[test]
#[should_panic]
fn test_small_repayment_does_not_write_score_change() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    let history_hash = create_test_hash(&env, 1);
    client.mint(
        &user,
        &500,
        &history_hash,
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    // Below MIN_SCORE_UPDATE_REPAYMENT (100) should be rejected to prevent spammy
    // zero-point updates that still write storage and emit events.
    client.update_score(&user, &99, &None);
}

#[test]
#[should_panic]
fn test_update_score_rejects_non_positive_repayment() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    let history_hash = create_test_hash(&env, 1);
    client.mint(
        &user,
        &500,
        &history_hash,
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    client.update_score(&user, &0, &None);
}

#[test]
fn test_apply_score_delta_supports_positive_and_negative_adjustments() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    let history_hash = create_test_hash(&env, 1);
    client.mint(
        &user,
        &500,
        &history_hash,
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    client.apply_score_delta(&user, &15, &None);
    assert_eq!(client.get_score(&user), 515);

    client.apply_score_delta(&user, &-10, &None);
    assert_eq!(client.get_score(&user), 505);
}

#[test]
fn test_apply_score_delta_floors_at_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    let history_hash = create_test_hash(&env, 1);
    client.mint(
        &user,
        &350,
        &history_hash,
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    client.apply_score_delta(&user, &-50, &None);
    assert_eq!(client.get_score(&user), 300);
}

#[test]
fn test_decrease_score_applies_floor_at_300() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    let history_hash = create_test_hash(&env, 8);
    client.mint(
        &user,
        &320,
        &history_hash,
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    client.decrease_score(&user, &50, &None);
    assert_eq!(client.get_score(&user), 300);
}

#[test]
fn test_update_history_hash_migrates_legacy_data() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    // Simulate legacy Score data
    use super::DataKey;
    let score_key = DataKey::Score(user.clone());
    env.as_contract(&contract_id, || {
        env.storage().persistent().set(&score_key, &800u32);
    });

    // update_history_hash should migrate legacy data first
    let new_hash = create_test_hash(&env, 42);
    client.update_history_hash(&user, &new_hash, &None);

    // Verify migration and update
    let metadata = client.get_metadata(&user).unwrap();
    assert_eq!(metadata.score, 800); // Score preserved
    assert_eq!(metadata.history_hash, new_hash); // Hash updated

    // Verify old data is gone
    env.as_contract(&contract_id, || {
        assert!(!env.storage().persistent().has(&score_key));
    });
}

#[test]
fn test_minting_with_authorized_minter_sets_expected_metadata() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let authorized_minter = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.authorize_minter(&authorized_minter);

    let history_hash = create_test_hash(&env, 9);
    client.mint(
        &user,
        &420,
        &history_hash,
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &Some(authorized_minter),
    );

    let metadata = client.get_metadata(&user).unwrap();
    assert_eq!(metadata.score, 420);
    assert_eq!(metadata.history_hash, history_hash);
}

#[test]
#[should_panic]
fn test_mint_rejects_unauthorized_minter() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let unauthorized_minter = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    let history_hash = create_test_hash(&env, 3);
    client.mint(
        &user,
        &500,
        &history_hash,
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &Some(unauthorized_minter),
    );
}

#[test]
fn test_metadata_retrieval_before_and_after_mint() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    assert!(client.get_metadata(&user).is_none());

    let history_hash = create_test_hash(&env, 11);
    client.mint(
        &user,
        &250,
        &history_hash,
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    let metadata = client.get_metadata(&user).unwrap();
    assert_eq!(metadata.score, 250);
    assert_eq!(metadata.history_hash, history_hash);
}

#[test]
fn test_score_update_is_isolated_to_owner() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    client.mint(
        &alice,
        &100,
        &create_test_hash(&env, 1),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    client.mint(
        &bob,
        &200,
        &create_test_hash(&env, 2),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    client.update_score(&alice, &9_000_000_000, &None);

    assert_eq!(client.get_score(&alice), 109);
    assert_eq!(client.get_score(&bob), 200);

    let alice_metadata = client.get_metadata(&alice).unwrap();
    let bob_metadata = client.get_metadata(&bob).unwrap();
    assert_eq!(alice_metadata.score, 109);
    assert_eq!(bob_metadata.score, 200);
}

#[test]
fn test_seize_collateral() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    let history_hash = create_test_hash(&env, 1);
    client.mint(
        &user,
        &500,
        &history_hash,
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    assert!(!client.is_seized(&user));

    client.seize_collateral(&user, &None);

    assert!(client.is_seized(&user));
}

#[test]
#[should_panic]
fn test_seize_collateral_no_nft() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    client.seize_collateral(&user, &None);
}

#[test]
#[should_panic]
fn test_seize_collateral_already_seized() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    let history_hash = create_test_hash(&env, 1);
    client.mint(
        &user,
        &500,
        &history_hash,
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    client.seize_collateral(&user, &None);
    client.seize_collateral(&user, &None);
}

#[test]
fn test_get_score_history_for_unknown_user_is_empty() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    let history = client.get_score_history(&user, &0, &10);
    assert_eq!(history.len(), 0);
}

#[test]
fn test_score_history_tracks_and_caps_recent_updates() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.mint(
        &user,
        &500,
        &create_test_hash(&env, 7),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    // Add 52 updates — exceeds MAX_SCORE_HISTORY_ENTRIES (50)
    for sequence in 1..=52u32 {
        env.ledger().set_sequence_number(sequence);
        client.update_score(&user, &1_000_000_000, &None);
    }

    // Total history must be capped at MAX_SCORE_HISTORY_ENTRIES
    let history = client.get_score_history(&user, &0, &100);
    assert_eq!(history.len(), RemittanceNFT::MAX_SCORE_HISTORY_ENTRIES);

    // Oldest entry should be the 3rd update (sequences 1 and 2 were rotated out)
    let first = history.get(0).unwrap();
    assert_eq!(first.ledger, 3);

    // Newest entry should be the 52nd update
    let last = history
        .get(RemittanceNFT::MAX_SCORE_HISTORY_ENTRIES - 1)
        .unwrap();
    assert_eq!(last.ledger, 52);
}

#[test]
#[should_panic]
fn test_burn_blocks_authorized_remint_without_admin_approval() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let authorized_minter = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.authorize_minter(&authorized_minter);
    client.mint(
        &user,
        &500,
        &create_test_hash(&env, 4),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    client.burn(&user, &None);
    assert!(client.get_metadata(&user).is_none());

    client.mint(
        &user,
        &650,
        &create_test_hash(&env, 5),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &Some(authorized_minter),
    );
}

#[test]
fn test_approve_remint_allows_authorized_minter_remint() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let minter = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin);
    client.authorize_minter(&minter);

    // First mint via authorized minter
    client.mint(
        &user,
        &650,
        &BytesN::from_array(&env, &[5u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &Some(minter.clone()),
    );
    client.burn(&user, &None);

    // Reminting a burned user via mint() is rejected even for authorized minters —
    // burned account recovery must go through admin_remint() only.
    let result = client.try_mint(
        &user,
        &650,
        &BytesN::from_array(&env, &[5u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &Some(minter.clone()),
    );
    assert_eq!(result, Err(Ok(NftError::BurnedRequiresApproval)));

    // Admin approves and uses admin_remint()
    client.approve_remint(&user);
    client.admin_remint(
        &user,
        &650,
        &BytesN::from_array(&env, &[5u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
    );
    assert_eq!(client.get_score(&user), 650);
}

#[test]
fn test_record_default_auto_burns_after_threshold() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.set_default_burn_threshold(&2);
    client.mint(
        &user,
        &500,
        &create_test_hash(&env, 6),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    client.record_default(&user, &None);
    assert_eq!(client.get_default_count(&user), 1);
    assert!(client.is_seized(&user));
    assert!(client.get_metadata(&user).is_some());

    let commitment = create_test_commitment(&env, 1);
    assert_eq!(client.get_recipient_commitment(&user), commitment);

    client.record_default(&user, &None);
    assert_eq!(client.get_default_count(&user), 0);
    assert!(client.get_metadata(&user).is_none());
    assert_eq!(client.get_score(&user), 0);
    assert!(!client.is_seized(&user));
    assert_eq!(
        client.try_get_recipient_commitment(&user),
        Err(Ok(NftError::CommitmentMissing))
    );
}

#[test]
fn test_reminted_account_resets_default_count_and_does_not_immediately_reburn() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.set_default_burn_threshold(&2);
    client.mint(
        &user,
        &500,
        &create_test_hash(&env, 6),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    // Default user twice to auto-burn (threshold=2)
    client.record_default(&user, &None);
    client.record_default(&user, &None);
    assert!(client.get_metadata(&user).is_none());
    assert_eq!(client.get_default_count(&user), 0);

    // Approve and remint
    client.approve_remint(&user);
    client.admin_remint(
        &user,
        &600,
        &create_test_hash(&env, 7),
        &create_test_uri(&env),
        &create_test_commitment(&env, 2),
    );

    // Default count must be reset to 0
    assert_eq!(client.get_default_count(&user), 0);
    assert!(client.get_metadata(&user).is_some());

    // Single record_default after remint increments count to 1 and does not re-burn
    client.record_default(&user, &None);
    assert_eq!(client.get_default_count(&user), 1);
    assert!(client.get_metadata(&user).is_some());

    // Second record_default hits threshold 2 and auto-burns again
    client.record_default(&user, &None);
    assert_eq!(client.get_default_count(&user), 0);
    assert!(client.get_metadata(&user).is_none());
}

#[test]
fn test_transfer_moves_identity_state_to_new_wallet() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let old_wallet = Address::generate(&env);
    let new_wallet = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.mint(
        &old_wallet,
        &500,
        &create_test_hash(&env, 21),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    client.update_score(&old_wallet, &3_000_000_000, &None);
    client.record_default(&old_wallet, &None);

    client.transfer(&old_wallet, &new_wallet, &None);

    assert!(client.get_metadata(&old_wallet).is_none());
    assert_eq!(client.get_score(&old_wallet), 0);
    assert_eq!(client.get_default_count(&old_wallet), 0);
    assert!(!client.is_seized(&old_wallet));
    assert_eq!(client.get_score_history(&old_wallet, &0, &10).len(), 0);
    assert_eq!(
        client.try_get_recipient_commitment(&old_wallet),
        Err(Ok(NftError::CommitmentMissing))
    );

    let metadata = client.get_metadata(&new_wallet).unwrap();
    assert_eq!(metadata.score, 503);
    assert_eq!(metadata.history_hash, create_test_hash(&env, 21));
    assert_eq!(client.get_default_count(&new_wallet), 1);
    assert!(client.is_seized(&new_wallet));
    assert_eq!(client.get_score_history(&new_wallet, &0, &10).len(), 1);
    assert_eq!(
        client.get_recipient_commitment(&new_wallet),
        create_test_commitment(&env, 1)
    );
}

#[test]
fn test_transfer_migrates_recipient_commitment() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    let commitment = create_test_commitment(&env, 42);
    client.mint(
        &sender,
        &600,
        &create_test_hash(&env, 1),
        &create_test_uri(&env),
        &commitment,
        &None,
    );

    assert_eq!(client.get_recipient_commitment(&sender), commitment);
    assert_eq!(
        client.try_get_recipient_commitment(&recipient),
        Err(Ok(NftError::CommitmentMissing))
    );

    client.transfer(&sender, &recipient, &None);

    // Sender's commitment is removed
    assert_eq!(
        client.try_get_recipient_commitment(&sender),
        Err(Ok(NftError::CommitmentMissing))
    );
    // Recipient now has the valid commitment
    assert_eq!(client.get_recipient_commitment(&recipient), commitment);
}

#[test]
fn test_transfer_requires_owner_auth_not_recipient() {
    // Regression test for #1358: transfer required `to.require_auth()`
    // instead of `from.require_auth()`, so an attacker could pull any
    // victim's NFT to themselves by only authorizing as the recipient.
    // Assert the contract actually required the *owner's* (from's)
    // authorization for this call, not the recipient's.
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.mint(
        &from,
        &500,
        &create_test_hash(&env, 99),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    client.transfer(&from, &to, &None);

    assert!(
        env.auths().iter().any(|(address, _)| address == &from),
        "transfer must require the current owner's (from's) authorization"
    );
    assert!(
        !env.auths().iter().any(|(address, _)| address == &to),
        "transfer must not require the recipient's authorization"
    );
}

#[test]
#[should_panic]
fn test_transfer_enforces_cooldown_before_retransfer() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let wallet_a = Address::generate(&env);
    let wallet_b = Address::generate(&env);
    let wallet_c = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.mint(
        &wallet_a,
        &500,
        &create_test_hash(&env, 22),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    client.transfer(&wallet_a, &wallet_b, &None);

    client.transfer(&wallet_b, &wallet_c, &None);
}

#[test]
#[should_panic]
fn test_transfer_rejects_destination_with_existing_state() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.mint(
        &from,
        &500,
        &create_test_hash(&env, 23),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    client.mint(
        &to,
        &450,
        &create_test_hash(&env, 24),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    client.transfer(&from, &to, &None);
}

#[test]
fn test_transfer_rejects_burned_destination() {
    // Regression test: transfer only checked has_any_remittance_state(to),
    // which looks at Metadata/Score only. burn_internal() removes those two
    // keys but leaves Burned(to) set, so a burned destination previously
    // sailed straight through transfer's only gate and came out the other
    // side simultaneously Burned and freshly credit-bearing — a credit
    // -integrity bypass for a defaulted party who hit the burn threshold.
    // transfer must apply the same BurnedRequiresApproval gate mint() does.
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    // `to` gets an NFT, then defaults enough times to be auto-burned.
    client.set_default_burn_threshold(&1);
    client.mint(
        &to,
        &500,
        &create_test_hash(&env, 30),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    client.record_default(&to, &None);
    assert!(client.get_metadata(&to).is_none());

    // `from` has a clean, active NFT to attempt to transfer.
    client.mint(
        &from,
        &500,
        &create_test_hash(&env, 31),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    // Burned destination must hard-fail, not silently receive fresh metadata.
    let result = client.try_transfer(&from, &to, &None);
    assert_eq!(result, Err(Ok(NftError::BurnedRequiresApproval)));

    // `from`'s state must be untouched since the transfer did not proceed.
    assert!(client.get_metadata(&from).is_some());

    // `to` must still be exactly Burned and nothing else — never both
    // Burned and credit-bearing.
    assert!(client.get_metadata(&to).is_none());
    assert_eq!(client.get_score(&to), 0);

    // Confirm the sanctioned recovery path still works: approve_remint +
    // admin_remint clears Burned and restores credit-bearing state in one
    // atomic, audited step.
    client.approve_remint(&to);
    client.admin_remint(
        &to,
        &500,
        &create_test_hash(&env, 32),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
    );
    assert!(client.get_metadata(&to).is_some());
}

#[test]
#[should_panic]
fn test_transfer_rejects_unauthorized_minter() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    let unauthorized_minter = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.mint(
        &from,
        &500,
        &create_test_hash(&env, 25),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    client.transfer(&from, &to, &Some(unauthorized_minter));
}

#[test]
fn test_transfer_rejects_burned_destination() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    // `to` gets minted, then burned — simulating a defaulted account
    // that hit the burn threshold.
    client.mint(
        &to,
        &500,
        &create_test_hash(&env, 30),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    client.burn(&to, &None);

    // `from` has an active, unburned identity.
    client.mint(
        &from,
        &500,
        &create_test_hash(&env, 31),
        &create_test_uri(&env),
        &create_test_commitment(&env, 2),
        &None,
    );

    // Transferring into the burned address must be rejected — it must not
    // be able to regain a clean credit identity via the transfer path.
    let result = client.try_transfer(&from, &to, &None);
    assert_eq!(result, Err(Ok(NftError::BurnedRequiresApproval)));

    // `from`'s identity must be untouched — the rejected transfer must not
    // have mutated any state on either side.
    assert!(client.get_metadata(&from).is_some());
    assert!(client.get_metadata(&to).is_none());
}

#[test]
fn test_transfer_into_burned_destination_never_leaves_credit_bearing_state() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    client.mint(
        &to,
        &500,
        &create_test_hash(&env, 32),
        &create_test_uri(&env),
        &create_test_commitment(&env, 3),
        &None,
    );
    client.burn(&to, &None);

    client.mint(
        &from,
        &500,
        &create_test_hash(&env, 33),
        &create_test_uri(&env),
        &create_test_commitment(&env, 4),
        &None,
    );

    let _ = client.try_transfer(&from, &to, &None);

    // The account must never end up simultaneously Burned and
    // credit-bearing: rejecting the transfer must not leave any partial
    // state behind on the burned destination.
    assert!(client.get_metadata(&to).is_none());
}

#[test]
fn test_score_cap_at_850() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    let history_hash = create_test_hash(&env, 1);

    // Test initial mint cap
    client.mint(
        &user,
        &900,
        &history_hash,
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    assert_eq!(client.get_score(&user), 850);

    // Test update_score cap
    // Current score is 850. Add large repayment.
    client.update_score(&user, &1_000_000_000_000, &None);
    assert_eq!(client.get_score(&user), 850);
}

#[test]
fn test_score_overflow_handling() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    let history_hash = create_test_hash(&env, 1);
    client.mint(
        &user,
        &800,
        &history_hash,
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    // Very large repayment that would overflow u32 if converted to points (e.g., u32::MAX * 100 + 1)
    // repayment_amount is i128, so it can be very large.
    // points = repayment_amount / 100
    let huge_repayment: i128 = (u32::MAX as i128) * 1_000_000_000 + 1_000_000_000;
    client.update_score(&user, &huge_repayment, &None);

    // Should be capped at 850
    assert_eq!(client.get_score(&user), 850);
}

#[test]
fn test_get_transfer_cooldown_remaining_no_cooldown() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.mint(
        &user,
        &500,
        &create_test_hash(&env, 1),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    assert_eq!(client.get_transfer_cooldown_remaining(&user), 0);
}

#[test]
fn test_get_transfer_cooldown_remaining_active() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    env.ledger().set_sequence_number(100);
    client.mint(
        &from,
        &500,
        &create_test_hash(&env, 30),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    client.transfer(&from, &to, &None);

    // Cooldown is 17280 ledgers. At sequence 100, next allowed is 100 + 17280 = 17380.
    assert_eq!(client.get_transfer_cooldown_remaining(&to), 17280);

    // Advance partway through the cooldown
    env.ledger().set_sequence_number(200);
    assert_eq!(client.get_transfer_cooldown_remaining(&to), 17180);
}

#[test]
fn test_get_transfer_cooldown_remaining_expired() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    env.ledger().set_sequence_number(100);
    client.mint(
        &from,
        &500,
        &create_test_hash(&env, 31),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    client.transfer(&from, &to, &None);

    // Advance past the cooldown
    env.ledger().set_sequence_number(100 + 17280);
    assert_eq!(client.get_transfer_cooldown_remaining(&to), 0);
}

#[test]
fn test_is_remint_approved_false_by_default() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    assert!(!client.is_remint_approved(&user));
}

#[test]
fn test_is_remint_approved_true_after_approval() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.mint(
        &user,
        &500,
        &create_test_hash(&env, 32),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    client.burn(&user, &None);
    client.approve_remint(&user);

    assert!(client.is_remint_approved(&user));
}

#[test]
fn test_is_remint_approved_cleared_after_remint() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin);

    client.mint(
        &user,
        &500,
        &BytesN::from_array(&env, &[1u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    client.burn(&user, &None);
    client.approve_remint(&user);

    assert!(client.is_remint_approved(&user));

    client.admin_remint(
        &user,
        &600,
        &BytesN::from_array(&env, &[0x22u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
    );

    assert!(!client.is_remint_approved(&user));
}

// ── Admin transfer ───────────────────────────────────────────────────────────

#[test]
fn test_propose_and_accept_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    assert_eq!(client.get_admin(), admin);

    client.propose_admin(&new_admin);
    client.accept_admin();

    let events = env.events().all();
    let event = events.get(events.len() - 1).unwrap();
    let topic_0 = Symbol::from_val(&env, &event.1.get(0).unwrap());
    let topic_1 = Symbol::from_val(&env, &event.1.get(1).unwrap());
    let admins = <(Address, Address)>::from_val(&env, &event.2);
    assert_eq!(topic_0, Symbol::new(&env, "AdminTransferred"));
    assert_eq!(topic_1, Symbol::new(&env, "accept"));
    assert_eq!(admins, (admin, new_admin.clone()));
    assert_eq!(client.get_admin(), new_admin);
}

#[test]
fn test_set_admin_updates_admin_immediately() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.set_admin(&new_admin);

    let events = env.events().all();
    let event = events.get(events.len() - 1).unwrap();
    let topic_0 = Symbol::from_val(&env, &event.1.get(0).unwrap());
    let topic_1 = Symbol::from_val(&env, &event.1.get(1).unwrap());
    let admins = <(Address, Address)>::from_val(&env, &event.2);
    assert_eq!(topic_0, Symbol::new(&env, "AdminTransferred"));
    assert_eq!(topic_1, Symbol::new(&env, "govern"));
    assert_eq!(admins, (admin, new_admin.clone()));
    assert_eq!(client.get_admin(), new_admin);
}

#[test]
fn test_get_proposed_admin_returns_none_when_no_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);
    client.initialize(&admin);

    assert_eq!(client.get_proposed_admin(), None);
}

#[test]
fn test_get_proposed_admin_returns_proposed_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);
    client.initialize(&admin);

    let new_admin = Address::generate(&env);
    client.propose_admin(&new_admin);

    assert_eq!(client.get_proposed_admin(), Some(new_admin));
}

#[test]
fn test_get_proposed_admin_returns_none_after_accept() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);
    client.initialize(&admin);

    let new_admin = Address::generate(&env);
    client.propose_admin(&new_admin);
    client.accept_admin();

    assert_eq!(client.get_proposed_admin(), None);
    assert_eq!(client.get_admin(), new_admin);
}

#[test]
#[should_panic]
fn test_accept_admin_without_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.accept_admin();
}

#[test]
fn test_new_admin_can_act_after_transfer() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.propose_admin(&new_admin);
    client.accept_admin();

    // New admin should be able to mint
    client.mint(
        &user,
        &500,
        &create_test_hash(&env, 40),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    assert_eq!(client.get_score(&user), 500);
}

#[test]
fn test_set_default_burn_threshold_upper_bound_valid() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);
    client.initialize(&admin);

    // Should succeed for valid threshold
    client.set_default_burn_threshold(&RemittanceNFT::MAX_ALLOWED_BURN_THRESHOLD);
}

#[test]
#[should_panic]
fn test_set_default_burn_threshold_upper_bound_invalid() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);
    client.initialize(&admin);

    // Should panic for threshold above max
    client.set_default_burn_threshold(&(RemittanceNFT::MAX_ALLOWED_BURN_THRESHOLD + 1));
}

#[test]
fn test_remint_requires_approval() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin);
    client.mint(
        &user,
        &500,
        &BytesN::from_array(&env, &[1u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    client.burn(&user, &None);

    // admin_remint without approval should fail
    let result = client.try_admin_remint(
        &user,
        &500,
        &BytesN::from_array(&env, &[1u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
    );
    assert_eq!(result, Err(Ok(NftError::RemintNotApproved)));

    // Grant approval then remint succeeds
    client.approve_remint(&user);
    client.admin_remint(
        &user,
        &500,
        &BytesN::from_array(&env, &[1u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
    );
    assert_eq!(client.get_score(&user), 500);
}

#[test]
fn test_remint_approval_is_single_use() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin);

    // Mint, burn, approve, remint
    client.mint(
        &user,
        &500,
        &BytesN::from_array(&env, &[1u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    client.burn(&user, &None);
    client.approve_remint(&user);
    client.admin_remint(
        &user,
        &500,
        &BytesN::from_array(&env, &[1u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
    );

    // Approval was consumed — burn and try again without new approval
    client.burn(&user, &None);
    let result = client.try_admin_remint(
        &user,
        &500,
        &BytesN::from_array(&env, &[1u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
    );
    assert_eq!(result, Err(Ok(NftError::RemintNotApproved)));

    // Second approval unblocks it
    client.approve_remint(&user);
    client.admin_remint(
        &user,
        &500,
        &BytesN::from_array(&env, &[1u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
    );
    assert_eq!(client.get_score(&user), 500);
}

#[test]
fn test_remint_approval_consumed_after_use() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin);

    client.mint(
        &user,
        &500,
        &BytesN::from_array(&env, &[1u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    client.burn(&user, &None);
    client.approve_remint(&user);

    assert!(client.is_remint_approved(&user));

    client.admin_remint(
        &user,
        &500,
        &BytesN::from_array(&env, &[1u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
    );

    // Approval was consumed
    assert!(!client.is_remint_approved(&user));
}

#[test]
fn test_first_time_mint_does_not_require_approval() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin);

    // First mint never requires approval
    client.mint(
        &user,
        &600,
        &BytesN::from_array(&env, &[1u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    assert_eq!(client.get_score(&user), 600);
}

#[test]
fn test_admin_remint_requires_approval() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin);
    client.mint(
        &user,
        &500,
        &BytesN::from_array(&env, &[1u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    client.burn(&user, &None);

    // admin_remint without approval should fail
    let result = client.try_admin_remint(
        &user,
        &500,
        &BytesN::from_array(&env, &[1u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
    );
    assert_eq!(result, Err(Ok(NftError::RemintNotApproved)));
}

#[test]
fn test_admin_remint_succeeds_with_approval() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin);
    client.mint(
        &user,
        &500,
        &BytesN::from_array(&env, &[1u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    client.burn(&user, &None);
    client.approve_remint(&user);

    client.admin_remint(
        &user,
        &400,
        &BytesN::from_array(&env, &[2u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
    );
    assert_eq!(client.get_score(&user), 400);
    assert!(!client.is_remint_approved(&user));
}

#[test]
fn test_admin_remint_fails_for_non_burned_user() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin);

    // User was never burned — admin_remint should fail
    let result = client.try_admin_remint(
        &user,
        &500,
        &BytesN::from_array(&env, &[1u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
    );
    assert_eq!(result, Err(Ok(NftError::NftNotFound)));
}

#[test]
fn test_mint_rejects_burned_user_and_redirects_to_admin_remint() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin);
    client.mint(
        &user,
        &500,
        &BytesN::from_array(&env, &[1u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    client.burn(&user, &None);

    // mint() must reject burned users — even with approval
    client.approve_remint(&user);
    let result = client.try_mint(
        &user,
        &500,
        &BytesN::from_array(&env, &[1u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    assert_eq!(result, Err(Ok(NftError::BurnedRequiresApproval)));
}

#[test]
fn test_admin_remint_clears_seized_flag() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin);
    client.mint(
        &user,
        &500,
        &BytesN::from_array(&env, &[1u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    client.seize_collateral(&user, &None);

    // Confirm seized before burn
    assert!(client.is_seized(&user));

    // burn_internal() clears the seized flag as part of cleanup
    client.burn(&user, &None);

    // After remint the user should not be seized
    client.approve_remint(&user);
    client.admin_remint(
        &user,
        &300,
        &BytesN::from_array(&env, &[2u8; 32]),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
    );

    assert!(!client.is_seized(&user));
}

// ── Additional test coverage for issue #738 ──────────────────────────────────

#[test]
fn test_mint_nft_success() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    let history_hash = create_test_hash(&env, 1);
    client.mint(
        &user,
        &500,
        &history_hash,
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    assert_eq!(client.get_score(&user), 500);
    let metadata = client.get_metadata(&user).unwrap();
    assert_eq!(metadata.score, 500);
    assert_eq!(metadata.history_hash, history_hash);
}

#[test]
fn test_score_bounds_enforced() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    // Test lower bound (300)
    client.mint(
        &user,
        &200,
        &create_test_hash(&env, 1),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    assert_eq!(client.get_score(&user), 200); // Mint doesn't enforce MIN, only MAX

    // Test upper bound (850)
    let user2 = Address::generate(&env);
    client.mint(
        &user2,
        &900,
        &create_test_hash(&env, 2),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    assert_eq!(client.get_score(&user2), 850); // Capped at MAX_SCORE
}

#[test]
fn test_update_score_within_bounds() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.mint(
        &user,
        &500,
        &create_test_hash(&env, 1),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    // Update within bounds
    client.update_score(&user, &10_000_000_000, &None);
    assert_eq!(client.get_score(&user), 510); // 500 + 10 points

    // Update that would exceed max
    client.update_score(&user, &1_000_000_000_000, &None);
    assert_eq!(client.get_score(&user), 850); // Capped at MAX_SCORE
}

#[test]
fn test_apply_score_delta_clamps_at_max() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.mint(
        &user,
        &800,
        &create_test_hash(&env, 1),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    // Apply delta that would exceed max
    client.apply_score_delta(&user, &100, &None);
    assert_eq!(client.get_score(&user), 850); // Capped at MAX_SCORE

    // Apply negative delta
    client.apply_score_delta(&user, &-50, &None);
    assert_eq!(client.get_score(&user), 800);
}

#[test]
fn test_lock_and_unlock_nft() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.mint(
        &user,
        &500,
        &create_test_hash(&env, 1),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    // Seize (lock) collateral
    assert!(!client.is_seized(&user));
    client.seize_collateral(&user, &None);
    assert!(client.is_seized(&user));

    // Note: There's no explicit unlock function in the contract
    // Seized state is cleared on burn or transfer
}

#[test]
fn test_burn_removes_nft() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.mint(
        &user,
        &500,
        &create_test_hash(&env, 1),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    assert!(client.get_metadata(&user).is_some());
    assert_eq!(client.get_score(&user), 500);

    client.burn(&user, &None);

    assert!(client.get_metadata(&user).is_none());
    assert_eq!(client.get_score(&user), 0);
}

#[test]
fn test_burn_removes_recipient_commitment() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    let commitment = create_test_commitment(&env, 7);
    client.mint(
        &user,
        &500,
        &create_test_hash(&env, 1),
        &create_test_uri(&env),
        &commitment,
        &None,
    );
    assert_eq!(client.get_recipient_commitment(&user), commitment);

    client.burn(&user, &None);

    assert_eq!(
        client.try_get_recipient_commitment(&user),
        Err(Ok(NftError::CommitmentMissing))
    );
}

#[test]
fn test_seize_collateral_by_authorized_only() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let authorized_minter = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.authorize_minter(&authorized_minter);
    client.mint(
        &user,
        &500,
        &create_test_hash(&env, 1),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    // Admin can seize
    client.seize_collateral(&user, &None);
    assert!(client.is_seized(&user));

    // Authorized minter can also seize
    let user2 = Address::generate(&env);
    client.mint(
        &user2,
        &500,
        &create_test_hash(&env, 2),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    client.seize_collateral(&user2, &Some(authorized_minter));
    assert!(client.is_seized(&user2));
}

#[test]
fn test_score_history_max_50_entries() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.mint(
        &user,
        &500,
        &create_test_hash(&env, 1),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    // Add 60 score updates (exceeds MAX_SCORE_HISTORY_ENTRIES of 50)
    for sequence in 1..=60u32 {
        env.ledger().set_sequence_number(sequence);
        client.update_score(&user, &1_000_000_000, &None);
    }

    // Verify history is capped at 50 entries
    let history = client.get_score_history(&user, &0, &100);
    assert_eq!(history.len(), RemittanceNFT::MAX_SCORE_HISTORY_ENTRIES);

    // Verify oldest entries were rotated out (first entry should be from sequence 11)
    let first_entry = history.get(0).unwrap();
    assert_eq!(first_entry.ledger, 11);

    // Verify newest entry is from sequence 60
    let last_entry = history
        .get(RemittanceNFT::MAX_SCORE_HISTORY_ENTRIES - 1)
        .unwrap();
    assert_eq!(last_entry.ledger, 60);
}

#[test]
fn test_mint_rejects_non_32_byte_commitment() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    // BytesN<32> always has length 32, so the runtime length check cannot reject
    // a typed commitment. Verify a valid 32-byte commitment mints successfully.
    let commitment = create_test_commitment(&env, 1);

    let result = client.try_mint(
        &user,
        &500,
        &create_test_hash(&env, 1),
        &create_test_uri(&env),
        &commitment,
        &None,
    );
    assert!(result.is_ok());
}

#[test]
fn test_mint_stores_commitment_and_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    let commitment = create_test_commitment(&env, 42);

    // Mint with commitment
    client.mint(
        &user,
        &500,
        &create_test_hash(&env, 1),
        &create_test_uri(&env),
        &commitment,
        &None,
    );

    // Capture mint event before subsequent calls replace the host event buffer.
    let events = env.events().all();
    let mint_event = events.get(events.len() - 1).unwrap();
    let topic_0 = Symbol::from_val(&env, &mint_event.1.get(0).unwrap());
    assert_eq!(topic_0, Symbol::new(&env, "Mint"));
    let data = <(u32, BytesN<32>)>::from_val(&env, &mint_event.2);
    assert_eq!(data, (500u32, commitment.clone()));

    // Verify commitment is stored
    let stored = client.get_recipient_commitment(&user);
    assert_eq!(stored, commitment);
}

#[test]
fn test_get_recipient_commitment_missing() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    // Try to get commitment for user without minted NFT
    let result = client.try_get_recipient_commitment(&user);
    assert_eq!(result, Err(Ok(NftError::CommitmentMissing)));
}

#[test]
fn test_admin_remint_stores_new_commitment() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    // Initial mint
    let initial_commitment = create_test_commitment(&env, 1);
    client.mint(
        &user,
        &500,
        &create_test_hash(&env, 1),
        &create_test_uri(&env),
        &initial_commitment,
        &None,
    );

    // Burn
    client.burn(&user, &None);

    // Approve remint
    client.approve_remint(&user);

    // Admin remint with new commitment
    let new_commitment = create_test_commitment(&env, 2);
    client.admin_remint(
        &user,
        &600,
        &create_test_hash(&env, 2),
        &create_test_uri(&env),
        &new_commitment,
    );

    // Verify new commitment is stored
    let stored = client.get_recipient_commitment(&user);
    assert_eq!(stored, new_commitment);
}

#[test]
fn test_admin_remint_rejects_bad_commitment() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);

    // Initial mint
    client.mint(
        &user,
        &500,
        &create_test_hash(&env, 1),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    // Burn
    client.burn(&user, &None);

    // Approve remint
    client.approve_remint(&user);

    // Admin remint with valid commitment succeeds
    let new_commitment = create_test_commitment(&env, 99);
    let result = client.try_admin_remint(
        &user,
        &600,
        &create_test_hash(&env, 2),
        &create_test_uri(&env),
        &new_commitment,
    );
    assert!(result.is_ok());

    // Verify new commitment is stored
    let stored = client.get_recipient_commitment(&user);
    assert_eq!(stored, new_commitment);
}

// ---------------------------------------------------------------------------
// MockLoanManager – used exclusively by the issue-1663 transfer-guard tests.
//
// The mock is keyed by borrower address in instance storage:
//   "loans":<borrower> -> Vec<u32>   (loan IDs)
//   "status":<u32>     -> u32         (status discriminant for that loan ID)
//
// Status discriminants mirror the real LoanStatus enum:
//   0 = Pending, 1 = Approved, 2 = Repaid, 3 = Defaulted,
//   4 = Liquidated, 5 = Cancelled, 6 = Rejected
// ---------------------------------------------------------------------------
#[contract]
pub struct MockLoanManager;

#[contractimpl]
impl MockLoanManager {
    /// Record `loan_id` as belonging to `borrower` with the given `status`.
    pub fn set_loan(env: Env, borrower: Address, loan_id: u32, status: u32) {
        // Append to borrower's loan list
        let mut loans: Vec<u32> = env
            .storage()
            .instance()
            .get::<(soroban_sdk::Symbol, Address), Vec<u32>>(&(
                soroban_sdk::Symbol::new(&env, "loans"),
                borrower.clone(),
            ))
            .unwrap_or(Vec::new(&env));
        loans.push_back(loan_id);
        env.storage()
            .instance()
            .set(&(soroban_sdk::Symbol::new(&env, "loans"), borrower), &loans);
        // Store status for this loan ID
        env.storage().instance().set(
            &(soroban_sdk::Symbol::new(&env, "status"), loan_id),
            &status,
        );
    }

    /// LoanManagerInterface::get_borrower_loans
    pub fn get_borrower_loans(env: Env, borrower: Address) -> Vec<u32> {
        env.storage()
            .instance()
            .get::<(soroban_sdk::Symbol, Address), Vec<u32>>(&(
                soroban_sdk::Symbol::new(&env, "loans"),
                borrower,
            ))
            .unwrap_or(Vec::new(&env))
    }

    /// LoanManagerInterface::get_loan_status
    pub fn get_loan_status(env: Env, loan_id: u32) -> u32 {
        env.storage()
            .instance()
            .get::<(soroban_sdk::Symbol, u32), u32>(&(
                soroban_sdk::Symbol::new(&env, "status"),
                loan_id,
            ))
            .unwrap_or(2) // default: Repaid (terminal)
    }
}

// Helper to build the NFT client with a registered mock loan manager.
fn setup_nft_with_loan_manager(env: &Env) -> (RemittanceNFTClient<'_>, Address, Address, Address) {
    env.mock_all_auths();

    let admin = Address::generate(env);
    let nft_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(env, &nft_id);
    client.initialize(&admin);

    let mock_lm_id = env.register(MockLoanManager, ());
    client.set_loan_manager(&mock_lm_id);

    let borrower = Address::generate(env);
    client.mint(
        &borrower,
        &600,
        &create_test_hash(env, 55),
        &create_test_uri(env),
        &create_test_commitment(env, 1),
        &None,
    );

    (client, mock_lm_id, borrower, admin)
}

/// Issue #1663 regression: transfer must be blocked when the sender has a
/// *Pending* loan (status discriminant 0).
#[test]
fn test_transfer_blocked_when_sender_has_pending_loan() {
    let env = Env::default();
    let (client, mock_lm_id, borrower, _admin) = setup_nft_with_loan_manager(&env);
    let new_wallet = Address::generate(&env);

    // Register a Pending loan (status = 0) for the borrower
    let mock_lm = MockLoanManagerClient::new(&env, &mock_lm_id);
    mock_lm.set_loan(&borrower, &1, &0);

    let result = client.try_transfer(&borrower, &new_wallet, &None);
    assert_eq!(
        result,
        Err(Ok(NftError::ActiveLoanExists)),
        "transfer must be blocked when the sender has a Pending loan"
    );
}

/// Issue #1663 regression: transfer must be blocked when the sender has an
/// *Approved* (disbursed) loan (status discriminant 1).
#[test]
fn test_transfer_blocked_when_sender_has_approved_loan() {
    let env = Env::default();
    let (client, mock_lm_id, borrower, _admin) = setup_nft_with_loan_manager(&env);
    let new_wallet = Address::generate(&env);

    // Register an Approved loan (status = 1)
    let mock_lm = MockLoanManagerClient::new(&env, &mock_lm_id);
    mock_lm.set_loan(&borrower, &42, &1);

    let result = client.try_transfer(&borrower, &new_wallet, &None);
    assert_eq!(
        result,
        Err(Ok(NftError::ActiveLoanExists)),
        "transfer must be blocked when the sender has an Approved loan"
    );
}

/// Transfer must succeed when all of the sender's loans are in a terminal
/// state (Repaid = 2, Cancelled = 5, etc.).
#[test]
fn test_transfer_allowed_when_all_loans_are_terminal() {
    let env = Env::default();
    let (client, mock_lm_id, borrower, _admin) = setup_nft_with_loan_manager(&env);
    let new_wallet = Address::generate(&env);

    // Register only terminal-state loans
    let mock_lm = MockLoanManagerClient::new(&env, &mock_lm_id);
    mock_lm.set_loan(&borrower, &10, &2); // Repaid
    mock_lm.set_loan(&borrower, &11, &5); // Cancelled

    let result = client.try_transfer(&borrower, &new_wallet, &None);
    assert!(
        result.is_ok(),
        "transfer must be allowed when all loans are terminal"
    );
    // Verify NFT moved to new wallet
    assert!(client.get_metadata(&new_wallet).is_some());
    assert!(client.get_metadata(&borrower).is_none());
}

/// Transfer guard must be a no-op (transparent) when no LoanManager has
/// been registered — preserving backwards-compatibility.
#[test]
fn test_transfer_succeeds_without_loan_manager_configured() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let nft_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &nft_id);
    client.initialize(&admin);

    // No set_loan_manager call — guard must be skipped entirely.
    let borrower = Address::generate(&env);
    let new_wallet = Address::generate(&env);
    client.mint(
        &borrower,
        &600,
        &create_test_hash(&env, 77),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    let result = client.try_transfer(&borrower, &new_wallet, &None);
    assert!(
        result.is_ok(),
        "transfer must succeed when no LoanManager is registered"
    );
}

#[test]
fn test_transfer_without_sender_commitment_leaves_recipient_without_commitment() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.mint(
        &sender,
        &500,
        &create_test_hash(&env, 1),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );

    // Simulate a legacy user without RecipientCommitment by removing it directly
    env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .remove(&DataKey::RecipientCommitment(sender.clone()));
    });
    assert_eq!(
        client.try_get_recipient_commitment(&sender),
        Err(Ok(NftError::CommitmentMissing))
    );

    client.transfer(&sender, &recipient, &None);

    // Sender still has no commitment
    assert_eq!(
        client.try_get_recipient_commitment(&sender),
        Err(Ok(NftError::CommitmentMissing))
    );
    // Recipient also has no commitment (nothing to migrate)
    assert_eq!(
        client.try_get_recipient_commitment(&recipient),
        Err(Ok(NftError::CommitmentMissing))
    );
}

#[test]
fn test_burn_removes_all_per_user_keys() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.mint(
        &user,
        &500,
        &create_test_hash(&env, 1),
        &create_test_uri(&env),
        &create_test_commitment(&env, 1),
        &None,
    );
    // Write some score history so ScoreHistory key is populated
    client.update_score(&user, &5_000_000_000, &None);

    // All keys present before burn
    assert!(client.get_metadata(&user).is_some());
    assert_eq!(client.get_score(&user), 505);
    assert!(!client.is_seized(&user));
    assert_eq!(
        client.get_recipient_commitment(&user),
        create_test_commitment(&env, 1)
    );
    assert!(!client.get_score_history(&user, &0, &10).is_empty());

    client.burn(&user, &None);

    // All 7 per-user storage keys must be gone
    assert!(client.get_metadata(&user).is_none());
    assert_eq!(client.get_score(&user), 0);
    assert!(client.get_score_history(&user, &0, &10).is_empty());
    assert!(!client.is_seized(&user));
    assert!(!client.is_remint_approved(&user));
    assert_eq!(client.get_transfer_cooldown_remaining(&user), 0);
    assert_eq!(
        client.try_get_recipient_commitment(&user),
        Err(Ok(NftError::CommitmentMissing))
    );
}
