#![cfg_attr(not(test), no_std)]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, Symbol, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct RemittanceMetadata {
    pub score: u32,
    pub history_hash: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScoreHistoryEntry {
    pub ledger: u32,
    pub old_score: u32,
    pub new_score: u32,
    pub reason: Symbol,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Metadata(Address),
    Score(Address),
    AuthorizedMinter(Address),
    Seized(Address),
    Version,
    ScoreHistory(Address),
    DefaultCount(Address),
    Burned(Address),
    RemintApproval(Address),
    TransferCooldown(Address),
}

#[contract]
pub struct RemittanceNFT;

#[contractimpl]
impl RemittanceNFT {
    const INSTANCE_TTL_THRESHOLD: u32 = 17280;
    const INSTANCE_TTL_BUMP: u32 = 518400;
    const PERSISTENT_TTL_THRESHOLD: u32 = 17280;
    const PERSISTENT_TTL_BUMP: u32 = 518400;
    const CURRENT_VERSION: u32 = 2;
    const DEFAULT_BURN_THRESHOLD: u32 = 3;
    const MAX_SCORE_HISTORY: u32 = 10;
    const TRANSFER_COOLDOWN_LEDGERS: u32 = 17280;
    const MIN_CREDIT_SCORE: u32 = 300;
    const MAX_CREDIT_SCORE: u32 = 850;

    fn admin_key() -> soroban_sdk::Symbol {
        symbol_short!("ADMIN")
    }

    fn burn_threshold_key() -> soroban_sdk::Symbol {
        symbol_short!("BURNTHR")
    }

    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(Self::INSTANCE_TTL_THRESHOLD, Self::INSTANCE_TTL_BUMP);
    }

    fn bump_persistent_ttl(env: &Env, key: &DataKey) {
        env.storage().persistent().extend_ttl(
            key,
            Self::PERSISTENT_TTL_THRESHOLD,
            Self::PERSISTENT_TTL_BUMP,
        );
    }

    fn admin(env: &Env) -> Address {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&Self::admin_key())
            .expect("not initialized")
    }

    fn require_admin_or_authorized_minter(env: &Env, minter: Option<Address>) {
        if let Some(minter_addr) = minter {
            minter_addr.require_auth();
            let key = DataKey::AuthorizedMinter(minter_addr);
            let is_authorized = env.storage().persistent().has(&key);
            if is_authorized {
                Self::bump_persistent_ttl(env, &key);
            }
            if !is_authorized {
                panic!("minter is not authorized");
            }
        } else {
            Self::admin(env).require_auth();
        }
    }

    fn default_history_hash(env: &Env) -> BytesN<32> {
        BytesN::from_array(env, &[0u8; 32])
    }

    fn get_or_migrate_metadata(env: &Env, user: &Address) -> Option<RemittanceMetadata> {
        let metadata_key = DataKey::Metadata(user.clone());
        if let Some(metadata) = env.storage().persistent().get(&metadata_key) {
            Self::bump_persistent_ttl(env, &metadata_key);
            return Some(metadata);
        }

        let score_key = DataKey::Score(user.clone());
        if let Some(score) = env.storage().persistent().get::<DataKey, u32>(&score_key) {
            let migrated_metadata = RemittanceMetadata {
                score,
                history_hash: Self::default_history_hash(env),
            };
            env.storage()
                .persistent()
                .set(&metadata_key, &migrated_metadata);
            Self::bump_persistent_ttl(env, &metadata_key);
            env.storage().persistent().remove(&score_key);
            return Some(migrated_metadata);
        }

        None
    }

    fn get_score_history_or_default(env: &Env, user: &Address) -> Vec<ScoreHistoryEntry> {
        let key = DataKey::ScoreHistory(user.clone());
        if let Some(history) = env.storage().persistent().get(&key) {
            Self::bump_persistent_ttl(env, &key);
            history
        } else {
            Vec::new(env)
        }
    }

    fn write_score_history(env: &Env, user: &Address, history: Vec<ScoreHistoryEntry>) {
        let key = DataKey::ScoreHistory(user.clone());
        env.storage().persistent().set(&key, &history);
        Self::bump_persistent_ttl(env, &key);
    }

    fn append_score_history(
        env: &Env,
        user: &Address,
        old_score: u32,
        new_score: u32,
        reason: Symbol,
    ) {
        let current_history = Self::get_score_history_or_default(env, user);
        let mut next_history = Vec::new(env);
        let current_len = current_history.len();
        let keep_from = current_len.saturating_sub(Self::MAX_SCORE_HISTORY - 1);

        for (idx, entry) in current_history.iter().enumerate() {
            if (idx as u32) >= keep_from {
                next_history.push_back(entry);
            }
        }

        next_history.push_back(ScoreHistoryEntry {
            ledger: env.ledger().sequence(),
            old_score,
            new_score,
            reason,
        });
        Self::write_score_history(env, user, next_history);
    }

    fn has_active_nft(env: &Env, user: &Address) -> bool {
        let metadata_key = DataKey::Metadata(user.clone());
        if env.storage().persistent().has(&metadata_key) {
            Self::bump_persistent_ttl(env, &metadata_key);
            return true;
        }

        let score_key = DataKey::Score(user.clone());
        let has_legacy = env.storage().persistent().has(&score_key);
        if has_legacy {
            Self::bump_persistent_ttl(env, &score_key);
        }
        has_legacy
    }

    fn default_burn_threshold(env: &Env) -> u32 {
        let key = Self::burn_threshold_key();
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&key)
            .unwrap_or(Self::DEFAULT_BURN_THRESHOLD)
    }

    fn has_any_remittance_state(env: &Env, user: &Address) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Metadata(user.clone()))
            || env
                .storage()
                .persistent()
                .has(&DataKey::Score(user.clone()))
            || env
                .storage()
                .persistent()
                .has(&DataKey::DefaultCount(user.clone()))
            || env
                .storage()
                .persistent()
                .has(&DataKey::Seized(user.clone()))
            || env
                .storage()
                .persistent()
                .has(&DataKey::ScoreHistory(user.clone()))
            || env
                .storage()
                .persistent()
                .has(&DataKey::RemintApproval(user.clone()))
            || env
                .storage()
                .persistent()
                .has(&DataKey::Burned(user.clone()))
            || env
                .storage()
                .persistent()
                .has(&DataKey::TransferCooldown(user.clone()))
    }

    fn burn_internal(env: &Env, user: &Address) {
        env.storage()
            .persistent()
            .remove(&DataKey::Metadata(user.clone()));
        env.storage()
            .persistent()
            .remove(&DataKey::Score(user.clone()));
        env.storage()
            .persistent()
            .remove(&DataKey::ScoreHistory(user.clone()));
        env.storage()
            .persistent()
            .remove(&DataKey::Seized(user.clone()));
        env.storage()
            .persistent()
            .remove(&DataKey::RemintApproval(user.clone()));

        let burned_key = DataKey::Burned(user.clone());
        env.storage().persistent().set(&burned_key, &true);
        Self::bump_persistent_ttl(env, &burned_key);
        env.events()
            .publish((symbol_short!("NftBurned"), user.clone()), ());
    }

    pub fn initialize(env: Env, admin: Address) {
        let admin_key = Self::admin_key();
        if env.storage().instance().has(&admin_key) {
            panic!("already initialized");
        }
        env.storage().instance().set(&admin_key, &admin);
        env.storage()
            .instance()
            .set(&Self::burn_threshold_key(), &Self::DEFAULT_BURN_THRESHOLD);
        env.storage()
            .instance()
            .set(&DataKey::Version, &Self::CURRENT_VERSION);
        Self::bump_instance_ttl(&env);
        // Admin is automatically authorized to mint
        let key = DataKey::AuthorizedMinter(admin.clone());
        env.storage().persistent().set(&key, &true);
        Self::bump_persistent_ttl(&env, &key);
    }

    pub fn version(env: Env) -> u32 {
        Self::bump_instance_ttl(&env);
        env.storage().instance().get(&DataKey::Version).unwrap_or(0)
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        Self::admin(&env).require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    pub fn migrate(env: Env) {
        Self::admin(&env).require_auth();

        if !env.storage().instance().has(&Self::burn_threshold_key()) {
            env.storage()
                .instance()
                .set(&Self::burn_threshold_key(), &Self::DEFAULT_BURN_THRESHOLD);
        }
        env.storage()
            .instance()
            .set(&DataKey::Version, &Self::CURRENT_VERSION);
        Self::bump_instance_ttl(&env);
    }

    /// Authorize a contract or account to mint NFTs
    pub fn authorize_minter(env: Env, minter: Address) {
        Self::admin(&env).require_auth();

        let key = DataKey::AuthorizedMinter(minter);
        env.storage().persistent().set(&key, &true);
        Self::bump_persistent_ttl(&env, &key);
    }

    /// Revoke authorization for a contract or account to mint NFTs
    pub fn revoke_minter(env: Env, minter: Address) {
        Self::admin(&env).require_auth();

        env.storage()
            .persistent()
            .remove(&DataKey::AuthorizedMinter(minter));
    }

    /// Check if an address is authorized to mint
    pub fn is_authorized_minter(env: Env, minter: Address) -> bool {
        let key = DataKey::AuthorizedMinter(minter);
        let is_authorized = env.storage().persistent().has(&key);
        if is_authorized {
            Self::bump_persistent_ttl(&env, &key);
        }
        is_authorized
    }

    /// Mint an NFT representing a user's remittance history and reputation score
    /// Only authorized contracts/accounts can call this function
    /// If minter is provided, it must be authorized and must authorize the call
    /// If minter is None, admin must authorize the call
    pub fn mint(
        env: Env,
        user: Address,
        initial_score: u32,
        history_hash: BytesN<32>,
        minter: Option<Address>,
    ) {
        let admin_direct_mint = minter.is_none();
        Self::require_admin_or_authorized_minter(&env, minter);

        let metadata_key = DataKey::Metadata(user.clone());
        let score_key = DataKey::Score(user.clone());
        let burned_key = DataKey::Burned(user.clone());

        // Check if user already has an NFT (either new format or legacy)
        if env.storage().persistent().has(&metadata_key)
            || env.storage().persistent().has(&score_key)
        {
            panic!("user already has an NFT");
        }

        if env.storage().persistent().has(&burned_key) {
            let remint_approval_key = DataKey::RemintApproval(user.clone());
            let has_approval = env.storage().persistent().has(&remint_approval_key);

            if !admin_direct_mint && !has_approval {
                panic!("burned user requires admin approval to remint");
            }

            env.storage().persistent().remove(&burned_key);
            env.storage().persistent().remove(&remint_approval_key);
            env.storage()
                .persistent()
                .remove(&DataKey::Seized(user.clone()));
        }

        let metadata = RemittanceMetadata {
            score: initial_score,
            history_hash,
        };

        env.storage().persistent().set(&metadata_key, &metadata);
        Self::bump_persistent_ttl(&env, &metadata_key);
        env.events()
            .publish((symbol_short!("Mint"), user), initial_score);
    }

    /// Get the metadata (score and history hash) for a user's NFT
    pub fn get_metadata(env: Env, user: Address) -> Option<RemittanceMetadata> {
        Self::get_or_migrate_metadata(&env, &user)
    }

    /// Get the score for a user
    /// Handles backward compatibility by checking Metadata first, then legacy Score data
    pub fn get_score(env: Env, user: Address) -> u32 {
        Self::get_or_migrate_metadata(&env, &user)
            .map(|metadata| metadata.score)
            .unwrap_or(0)
    }

    /// Update the score for a user's NFT
    /// Only authorized contracts/accounts can call this function
    /// If minter is provided, it must be authorized and must authorize the call
    /// If minter is None, admin must authorize the call
    pub fn update_score(env: Env, user: Address, repayment_amount: i128, minter: Option<Address>) {
        if repayment_amount <= 0 {
            panic!("repayment amount must be positive");
        }
        Self::require_admin_or_authorized_minter(&env, minter);

        let metadata_key = DataKey::Metadata(user.clone());
        let mut metadata = Self::get_or_migrate_metadata(&env, &user)
            .unwrap_or_else(|| panic!("user does not have an NFT"));

        // Simple logic: 1 point per 100 units of repayment
        let points = (repayment_amount / 100) as u32;
        if points == 0 {
            return;
        }
        let old_score = metadata.score;
        metadata.score = old_score
            .saturating_add(points)
            .min(Self::MAX_CREDIT_SCORE);

        env.storage().persistent().set(&metadata_key, &metadata);
        Self::bump_persistent_ttl(&env, &metadata_key);
        Self::append_score_history(
            &env,
            &user,
            old_score,
            metadata.score,
            symbol_short!("REPAY"),
        );
        env.events()
            .publish((symbol_short!("ScoreUpd"), user), metadata.score);
    }

    pub fn decrease_score(env: Env, user: Address, penalty_points: u32, minter: Option<Address>) {
        Self::require_admin_or_authorized_minter(&env, minter);

        let metadata_key = DataKey::Metadata(user.clone());
        let mut metadata = Self::get_or_migrate_metadata(&env, &user)
            .unwrap_or_else(|| panic!("user does not have an NFT"));

        let old_score = metadata.score;
        let decreased = old_score.saturating_sub(penalty_points);
        let new_score = decreased.max(Self::MIN_CREDIT_SCORE);
        if new_score == old_score {
            return;
        }

        metadata.score = new_score;
        env.storage().persistent().set(&metadata_key, &metadata);
        Self::bump_persistent_ttl(&env, &metadata_key);
        Self::append_score_history(
            &env,
            &user,
            old_score,
            new_score,
            symbol_short!("DEC"),
        );
        env.events().publish(
            (symbol_short!("ScoreDecr"), user),
            (old_score, new_score, symbol_short!("PEN")),
        );
    }

    pub fn apply_score_delta(env: Env, user: Address, delta: i32, minter: Option<Address>) {
        Self::require_admin_or_authorized_minter(&env, minter);

        let metadata_key = DataKey::Metadata(user.clone());
        let mut metadata = Self::get_or_migrate_metadata(&env, &user)
            .unwrap_or_else(|| panic!("user does not have an NFT"));

        let old_score = metadata.score as i64;
        let next_score = old_score + delta as i64;
        let min_score = Self::MIN_CREDIT_SCORE as i64;
        let max_score = Self::MAX_CREDIT_SCORE as i64;
        let bounded_score = next_score.clamp(min_score, max_score);
        let next_score_u32 = u32::try_from(bounded_score).expect("score overflow");

        if next_score_u32 == metadata.score {
            return;
        }

        let previous_score = metadata.score;
        metadata.score = next_score_u32;

        env.storage().persistent().set(&metadata_key, &metadata);
        Self::bump_persistent_ttl(&env, &metadata_key);
        Self::append_score_history(
            &env,
            &user,
            previous_score,
            metadata.score,
            symbol_short!("ADJ"),
        );
        env.events()
            .publish((symbol_short!("ScoreUpd"), user), metadata.score);
    }

    /// Update the history hash for a user's NFT
    /// Only authorized contracts/accounts can call this function
    /// If minter is provided, it must be authorized and must authorize the call
    /// If minter is None, admin must authorize the call
    pub fn update_history_hash(
        env: Env,
        user: Address,
        new_history_hash: BytesN<32>,
        minter: Option<Address>,
    ) {
        Self::require_admin_or_authorized_minter(&env, minter);

        let metadata_key = DataKey::Metadata(user.clone());
        let mut metadata = Self::get_or_migrate_metadata(&env, &user)
            .unwrap_or_else(|| panic!("user does not have an NFT"));

        if metadata.history_hash == new_history_hash {
            return;
        }
        metadata.history_hash = new_history_hash;

        env.storage().persistent().set(&metadata_key, &metadata);
        Self::bump_persistent_ttl(&env, &metadata_key);
        env.events().publish(
            (symbol_short!("HashUpd"), user),
            metadata.history_hash.clone(),
        );
    }

    pub fn seize_collateral(env: Env, user: Address, minter: Option<Address>) {
        Self::require_admin_or_authorized_minter(&env, minter);

        let metadata_key = DataKey::Metadata(user.clone());
        if !env.storage().persistent().has(&metadata_key) {
            let score_key = DataKey::Score(user.clone());
            if !env.storage().persistent().has(&score_key) {
                panic!("user does not have an NFT");
            }
        }

        let seized_key = DataKey::Seized(user.clone());
        if env.storage().persistent().has(&seized_key) {
            panic!("collateral already seized");
        }

        env.storage().persistent().set(&seized_key, &true);
        Self::bump_persistent_ttl(&env, &seized_key);
        env.events().publish((symbol_short!("Seized"), user), ());
    }

    pub fn record_default(env: Env, user: Address, minter: Option<Address>) {
        Self::require_admin_or_authorized_minter(&env, minter);

        if !Self::has_active_nft(&env, &user) {
            panic!("user does not have an NFT");
        }

        let default_key = DataKey::DefaultCount(user.clone());
        let updated_count = env
            .storage()
            .persistent()
            .get::<DataKey, u32>(&default_key)
            .unwrap_or(0)
            .checked_add(1)
            .expect("default count overflow");
        env.storage().persistent().set(&default_key, &updated_count);
        Self::bump_persistent_ttl(&env, &default_key);

        let seized_key = DataKey::Seized(user.clone());
        if !env.storage().persistent().has(&seized_key) {
            env.storage().persistent().set(&seized_key, &true);
            Self::bump_persistent_ttl(&env, &seized_key);
            env.events()
                .publish((symbol_short!("Seized"), user.clone()), ());
        }

        if updated_count >= Self::default_burn_threshold(&env) {
            Self::burn_internal(&env, &user);
        }
    }

    pub fn burn(env: Env, user: Address, minter: Option<Address>) {
        Self::require_admin_or_authorized_minter(&env, minter);

        if !Self::has_active_nft(&env, &user) {
            panic!("user does not have an NFT");
        }

        Self::burn_internal(&env, &user);
    }

    pub fn transfer(env: Env, from: Address, to: Address, minter: Option<Address>) {
        if from == to {
            panic!("source and destination must differ");
        }

        from.require_auth();
        Self::require_admin_or_authorized_minter(&env, minter);

        let transfer_cooldown_key = DataKey::TransferCooldown(from.clone());
        if let Some(next_allowed_ledger) = env
            .storage()
            .persistent()
            .get::<DataKey, u32>(&transfer_cooldown_key)
        {
            Self::bump_persistent_ttl(&env, &transfer_cooldown_key);
            if env.ledger().sequence() < next_allowed_ledger {
                panic!("transfer cooldown active");
            }
        }

        let metadata = Self::get_or_migrate_metadata(&env, &from)
            .unwrap_or_else(|| panic!("user does not have an NFT"));

        if Self::has_any_remittance_state(&env, &to) {
            panic!("destination address has existing remittance state");
        }

        let from_metadata_key = DataKey::Metadata(from.clone());
        let to_metadata_key = DataKey::Metadata(to.clone());
        env.storage().persistent().set(&to_metadata_key, &metadata);
        Self::bump_persistent_ttl(&env, &to_metadata_key);
        env.storage().persistent().remove(&from_metadata_key);
        env.storage()
            .persistent()
            .remove(&DataKey::Score(from.clone()));

        let from_history_key = DataKey::ScoreHistory(from.clone());
        if let Some(history) = env
            .storage()
            .persistent()
            .get::<DataKey, Vec<ScoreHistoryEntry>>(&from_history_key)
        {
            let to_history_key = DataKey::ScoreHistory(to.clone());
            env.storage().persistent().set(&to_history_key, &history);
            Self::bump_persistent_ttl(&env, &to_history_key);
            env.storage().persistent().remove(&from_history_key);
        }

        let from_default_key = DataKey::DefaultCount(from.clone());
        if let Some(default_count) = env
            .storage()
            .persistent()
            .get::<DataKey, u32>(&from_default_key)
        {
            let to_default_key = DataKey::DefaultCount(to.clone());
            env.storage()
                .persistent()
                .set(&to_default_key, &default_count);
            Self::bump_persistent_ttl(&env, &to_default_key);
            env.storage().persistent().remove(&from_default_key);
        }

        let from_seized_key = DataKey::Seized(from.clone());
        if env.storage().persistent().has(&from_seized_key) {
            let to_seized_key = DataKey::Seized(to.clone());
            env.storage().persistent().set(&to_seized_key, &true);
            Self::bump_persistent_ttl(&env, &to_seized_key);
            env.storage().persistent().remove(&from_seized_key);
        }

        env.storage()
            .persistent()
            .remove(&DataKey::RemintApproval(from.clone()));

        env.storage().persistent().remove(&transfer_cooldown_key);
        let to_cooldown_key = DataKey::TransferCooldown(to.clone());
        let next_allowed_ledger = env
            .ledger()
            .sequence()
            .saturating_add(Self::TRANSFER_COOLDOWN_LEDGERS);
        env.storage()
            .persistent()
            .set(&to_cooldown_key, &next_allowed_ledger);
        Self::bump_persistent_ttl(&env, &to_cooldown_key);

        env.events()
            .publish((symbol_short!("Transfer"), from, to), ());
    }

    pub fn is_seized(env: Env, user: Address) -> bool {
        let seized_key = DataKey::Seized(user.clone());
        let is_seized = env.storage().persistent().has(&seized_key);
        if is_seized {
            Self::bump_persistent_ttl(&env, &seized_key);
        }
        is_seized
    }

    pub fn get_default_count(env: Env, user: Address) -> u32 {
        let key = DataKey::DefaultCount(user);
        let count = env.storage().persistent().get(&key).unwrap_or(0);
        if count > 0 {
            Self::bump_persistent_ttl(&env, &key);
        }
        count
    }

    pub fn approve_remint(env: Env, user: Address) {
        Self::admin(&env).require_auth();

        let approval_key = DataKey::RemintApproval(user);
        env.storage().persistent().set(&approval_key, &true);
        Self::bump_persistent_ttl(&env, &approval_key);
    }

    pub fn set_default_burn_threshold(env: Env, threshold: u32) {
        if threshold == 0 {
            panic!("default burn threshold must be positive");
        }
        Self::admin(&env).require_auth();

        env.storage()
            .instance()
            .set(&Self::burn_threshold_key(), &threshold);
        Self::bump_instance_ttl(&env);
    }

    pub fn get_default_burn_threshold(env: Env) -> u32 {
        Self::default_burn_threshold(&env)
    }

    pub fn get_score_history(env: Env, user: Address) -> Vec<ScoreHistoryEntry> {
        Self::get_score_history_or_default(&env, &user)
    }
}

#[cfg(test)]
mod test;
