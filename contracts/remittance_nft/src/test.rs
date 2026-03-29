use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Address, BytesN, Env};

fn create_test_hash(env: &Env, value: u8) -> BytesN<32> {
    let mut hash_bytes = [0u8; 32];
    hash_bytes[0] = value;
    BytesN::from_array(env, &hash_bytes)
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
    client.mint(&user, &500, &history_hash, &None);
    assert_eq!(client.get_score(&user), 500);

    // Check metadata
    let metadata = client.get_metadata(&user).unwrap();
    assert_eq!(metadata.score, 500);
    assert_eq!(metadata.history_hash, history_hash);

    // Update score (repayment of 250 -> 2 points) - admin updates
    client.update_score(&user, &250, &None);
    assert_eq!(client.get_score(&user), 502);

    // Verify metadata updated
    let metadata = client.get_metadata(&user).unwrap();
    assert_eq!(metadata.score, 502);

    // Update score (repayment of 1000 -> 10 points) - admin updates
    client.update_score(&user, &1000, &None);
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
    client.mint(&user, &500, &initial_hash, &None);

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
    client.mint(&user, &500, &initial_hash, &None);

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
    client.mint(&user, &500, &initial_hash, &None);

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

    // Authorize a contract
    client.authorize_minter(&authorized_contract);
    assert!(client.is_authorized_minter(&authorized_contract));

    // Revoke authorization
    client.revoke_minter(&authorized_contract);
    assert!(!client.is_authorized_minter(&authorized_contract));
}

#[test]
#[should_panic]
fn test_not_initialized() {
    let env = Env::default();
    let user = Address::generate(&env);
    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    let history_hash = create_test_hash(&env, 1);
    client.mint(&user, &500, &history_hash, &None);
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
    client.mint(&user, &500, &history_hash, &None);

    // Try to mint again for the same user
    let history_hash2 = create_test_hash(&env, 2);
    client.mint(&user, &600, &history_hash2, &None);
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
    client.update_score(&user, &100, &None);
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
    client.update_score(&user, &500, &None);
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
    client.update_score(&user, &200, &None);

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
fn test_small_repayment_does_not_write_score_change() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    let history_hash = create_test_hash(&env, 1);
    client.mint(&user, &500, &history_hash, &None);

    client.update_score(&user, &99, &None);
    assert_eq!(client.get_score(&user), 500);
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
    client.mint(&user, &500, &history_hash, &None);

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
    client.mint(&user, &500, &history_hash, &None);

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
    client.mint(&user, &350, &history_hash, &None);

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
    client.mint(&user, &320, &history_hash, &None);

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
    client.mint(&user, &420, &history_hash, &Some(authorized_minter));

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
    client.mint(&user, &500, &history_hash, &Some(unauthorized_minter));
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
    client.mint(&user, &250, &history_hash, &None);

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

    client.mint(&alice, &100, &create_test_hash(&env, 1), &None);
    client.mint(&bob, &200, &create_test_hash(&env, 2), &None);

    client.update_score(&alice, &900, &None);

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
    client.mint(&user, &500, &history_hash, &None);

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
    client.mint(&user, &500, &history_hash, &None);

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
    client.mint(&user, &500, &create_test_hash(&env, 7), &None);

    // Add 52 updates — exceeds MAX_SCORE_HISTORY_ENTRIES (50)
    for sequence in 1..=52u32 {
        env.ledger().set_sequence_number(sequence);
        client.update_score(&user, &100, &None);
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
    client.mint(&user, &500, &create_test_hash(&env, 4), &None);

    client.burn(&user, &None);
    assert!(client.get_metadata(&user).is_none());

    client.mint(
        &user,
        &650,
        &create_test_hash(&env, 5),
        &Some(authorized_minter),
    );
}

#[test]
fn test_approve_remint_allows_authorized_minter_remint() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let authorized_minter = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.authorize_minter(&authorized_minter);
    client.mint(&user, &500, &create_test_hash(&env, 4), &None);

    client.burn(&user, &None);
    client.approve_remint(&user);
    client.mint(
        &user,
        &650,
        &create_test_hash(&env, 5),
        &Some(authorized_minter),
    );

    let metadata = client.get_metadata(&user).unwrap();
    assert_eq!(metadata.score, 650);
    assert_eq!(metadata.history_hash, create_test_hash(&env, 5));
    assert!(!client.is_seized(&user));
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
    client.mint(&user, &500, &create_test_hash(&env, 6), &None);

    client.record_default(&user, &None);
    assert_eq!(client.get_default_count(&user), 1);
    assert!(client.is_seized(&user));
    assert!(client.get_metadata(&user).is_some());

    client.record_default(&user, &None);
    assert_eq!(client.get_default_count(&user), 2);
    assert!(client.get_metadata(&user).is_none());
    assert_eq!(client.get_score(&user), 0);
    assert!(!client.is_seized(&user));
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
    client.mint(&old_wallet, &500, &create_test_hash(&env, 21), &None);
    client.update_score(&old_wallet, &300, &None);
    client.record_default(&old_wallet, &None);

    client.transfer(&old_wallet, &new_wallet, &None);

    assert!(client.get_metadata(&old_wallet).is_none());
    assert_eq!(client.get_score(&old_wallet), 0);
    assert_eq!(client.get_default_count(&old_wallet), 0);
    assert!(!client.is_seized(&old_wallet));
    assert_eq!(client.get_score_history(&old_wallet, &0, &10).len(), 0);

    let metadata = client.get_metadata(&new_wallet).unwrap();
    assert_eq!(metadata.score, 503);
    assert_eq!(metadata.history_hash, create_test_hash(&env, 21));
    assert_eq!(client.get_default_count(&new_wallet), 1);
    assert!(client.is_seized(&new_wallet));
    assert_eq!(client.get_score_history(&new_wallet, &0, &10).len(), 1);
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
    client.mint(&wallet_a, &500, &create_test_hash(&env, 22), &None);
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
    client.mint(&from, &500, &create_test_hash(&env, 23), &None);
    client.mint(&to, &450, &create_test_hash(&env, 24), &None);

    client.transfer(&from, &to, &None);
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
    client.mint(&from, &500, &create_test_hash(&env, 25), &None);

    client.transfer(&from, &to, &Some(unauthorized_minter));
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
    client.mint(&user, &900, &history_hash, &None);
    assert_eq!(client.get_score(&user), 850);

    // Test update_score cap
    // Current score is 850. Add large repayment.
    client.update_score(&user, &100000, &None);
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
    client.mint(&user, &800, &history_hash, &None);

    // Very large repayment that would overflow u32 if converted to points (e.g., u32::MAX * 100 + 1)
    // repayment_amount is i128, so it can be very large.
    // points = repayment_amount / 100
    let huge_repayment: i128 = (u32::MAX as i128) * 100 + 100;
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
    client.mint(&user, &500, &create_test_hash(&env, 1), &None);

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
    client.mint(&from, &500, &create_test_hash(&env, 30), &None);
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
    client.mint(&from, &500, &create_test_hash(&env, 31), &None);
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
    client.mint(&user, &500, &create_test_hash(&env, 32), &None);
    client.burn(&user, &None);
    client.approve_remint(&user);

    assert!(client.is_remint_approved(&user));
}

#[test]
fn test_is_remint_approved_cleared_after_remint() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.mint(&user, &500, &create_test_hash(&env, 33), &None);
    client.burn(&user, &None);
    client.approve_remint(&user);
    assert!(client.is_remint_approved(&user));

    // Remint consumes the approval
    client.mint(&user, &600, &create_test_hash(&env, 34), &None);
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
    client.mint(&user, &500, &create_test_hash(&env, 40), &None);
    assert_eq!(client.get_score(&user), 500);
}
