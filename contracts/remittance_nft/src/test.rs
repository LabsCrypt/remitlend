#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

fn create_test_hash(env: &Env, value: u8) -> BytesN<32> {
    let mut hash_bytes = [0u8; 32];
    hash_bytes[0] = value;
    BytesN::from_array(env, &hash_bytes)
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
#[should_panic(expected = "not initialized")]
fn test_not_initialized() {
    let env = Env::default();
    let user = Address::generate(&env);
    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    let history_hash = create_test_hash(&env, 1);
    client.mint(&user, &500, &history_hash, &None);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_already_initialized() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = env.register(RemittanceNFT, ());
    let client = RemittanceNFTClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.initialize(&admin);
}

#[test]
#[should_panic(expected = "user already has an NFT")]
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
#[should_panic(expected = "user does not have an NFT")]
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
#[should_panic(expected = "repayment amount must be positive")]
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
#[should_panic(expected = "minter is not authorized")]
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
