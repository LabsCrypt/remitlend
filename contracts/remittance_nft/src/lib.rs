#![cfg_attr(not(test), no_std)]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env,
    Symbol, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum NftError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    UnauthorizedMinter = 3,
    NftAlreadyExists = 4,
    BurnedRequiresApproval = 5,
    NftNotFound = 6,
    InvalidRepaymentAmount = 7,
    CollateralAlreadySeized = 8,
    SelfTransfer = 9,
    DestinationOccupied = 10,
    TransferCooldownActive = 11,
    InvalidThreshold = 12,
    ContractPaused = 13,
    InvalidHistoryHash = 14,
    NoProposedAdmin = 15,
    RemintNotApproved = 16,
}

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
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScoreConfig {
    pub repayment_delta: u32,
    pub default_penalty: u32,
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
    Paused,
    ProposedAdmin,
    ScoreConfig,
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
    pub const MAX_SCORE_HISTORY_ENTRIES: u32 = 50;
    const TRANSFER_COOLDOWN_LEDGERS: u32 = 17280;
    const MIN_CREDIT_SCORE: u32 = 300;
    pub const MAX_SCORE: u32 = 850;
    pub const MAX_ALLOWED_BURN_THRESHOLD: u32 = 1000; // Set as appropriate for your business logic

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

    fn require_admin_or_authorized_minter(
        env: &Env,
        minter: Option<Address>,
    ) -> Result<(), NftError> {
        Self::assert_not_paused(env)?;
        if let Some(minter_addr) = minter {
            minter_addr.require_auth();
            let key = DataKey::AuthorizedMinter(minter_addr);
            let is_authorized = env.storage().persistent().has(&key);
            if is_authorized {
                Self::bump_persistent_ttl(env, &key);
            }
            if !is_authorized {
                return Err(NftError::UnauthorizedMinter);
            }
        } else {
            Self::admin(env).require_auth();
        }
        Ok(())
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
        if let Some(history) = env
            .storage()
            .persistent()
            .get::<DataKey, Vec<ScoreHistoryEntry>>(&key)
        {
            Self::bump_persistent_ttl(env, &key);
            // Migration: truncate to the most recent MAX_SCORE_HISTORY_ENTRIES if over limit
            let len = history.len();
            if len > Self::MAX_SCORE_HISTORY_ENTRIES {
                let keep_from = len - Self::MAX_SCORE_HISTORY_ENTRIES;
                let mut truncated = Vec::new(env);
                for (idx, entry) in history.iter().enumerate() {
                    if (idx as u32) >= keep_from {
                        truncated.push_back(entry);
                    }
                }
                Self::write_score_history(env, user, truncated.clone());
                return truncated;
            }
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
        let keep_from = current_len.saturating_sub(Self::MAX_SCORE_HISTORY_ENTRIES - 1);

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
        env.storage()
            .persistent()
            .remove(&DataKey::TransferCooldown(user.clone()));

        let burned_key = DataKey::Burned(user.clone());
        env.storage().persistent().set(&burned_key, &true);
        Self::bump_persistent_ttl(env, &burned_key);
        env.events()
            .publish((symbol_short!("NftBurned"), user.clone()), ());
    }

    pub fn initialize(env: Env, admin: Address) -> Result<(), NftError> {
        let admin_key = Self::admin_key();
        if env.storage().instance().has(&admin_key) {
            return Err(NftError::AlreadyInitialized);
        }
        env.storage().instance().set(&admin_key, &admin);
        env.storage()
            .instance()
            .set(&Self::burn_threshold_key(), &Self::DEFAULT_BURN_THRESHOLD);
        env.storage()
            .instance()
            .set(&DataKey::Version, &Self::CURRENT_VERSION);
        env.storage().instance().set(&DataKey::Paused, &false);
        Self::bump_instance_ttl(&env);
        // Admin is automatically authorized to mint
        let key = DataKey::AuthorizedMinter(admin.clone());
        env.storage().persistent().set(&key, &true);
        Self::bump_persistent_ttl(&env, &key);
        Ok(())
    }

    fn assert_not_paused(env: &Env) -> Result<(), NftError> {
        Self::bump_instance_ttl(env);
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            return Err(NftError::ContractPaused);
        }
        Ok(())
    }

    pub fn version(env: Env) -> u32 {
        Self::bump_instance_ttl(&env);
        env.storage().instance().get(&DataKey::Version).unwrap_or(0)
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        Self::admin(&env).require_auth();
        let old_version = Self::version(env.clone());
        let new_version = old_version.saturating_add(1);
        env.storage()
            .instance()
            .set(&DataKey::Version, &new_version);
        env.events().publish(
            (Symbol::new(&env, "ContractUpgraded"),),
            (old_version, new_version),
        );
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

        let key = DataKey::AuthorizedMinter(minter.clone());
        env.storage().persistent().set(&key, &true);
        Self::bump_persistent_ttl(&env, &key);

        env.events().publish((symbol_short!("MntAuth"), minter), ());
    }

    /// Revoke authorization for a contract or account to mint NFTs
    pub fn revoke_minter(env: Env, minter: Address) {
        Self::admin(&env).require_auth();

        env.storage()
            .persistent()
            .remove(&DataKey::AuthorizedMinter(minter.clone()));

        env.events().publish((symbol_short!("MntRev"), minter), ());
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

    /// Mint an NFT representing a user's remittance history and reputation score.
    /// If minter is provided, it must be authorized and must sign the call.
    /// If minter is None, admin must sign the call.
    pub fn mint(
        env: Env,
        user: Address,
        initial_score: u32,
        history_hash: BytesN<32>,
        minter: Option<Address>,
    ) {
        let _admin_direct_mint = minter.is_none();
        Self::require_admin_or_authorized_minter(&env, minter).unwrap();

        let metadata_key = DataKey::Metadata(user.clone());
        let score_key = DataKey::Score(user.clone());
        let burned_key = DataKey::Burned(user.clone());

        if env.storage().persistent().has(&metadata_key)
            || env.storage().persistent().has(&score_key)
        {
            panic!("nft already exists");
        }

        if env.storage().persistent().has(&burned_key) {
            panic!("burned requires approval");
        }

        let metadata = RemittanceMetadata {
            score: initial_score.min(Self::MAX_SCORE),
            history_hash,
        };

        env.storage().persistent().set(&metadata_key, &metadata);
        Self::bump_persistent_ttl(&env, &metadata_key);
        env.events()
            .publish((symbol_short!("Mint"), user), initial_score);
    }

    /// Re-mint an NFT for a previously burned account.
    ///
    /// Unlike `mint()`, this function:
    /// - Is admin-only (no authorized minter path)
    /// - Requires a prior `approve_remint()` call (enforced via RemintApproval storage key)
    /// - Emits a distinct `AdminRemint` event for audit trail separation
    /// - Cannot be used for first-time mints (only works if `Burned(user)` is set)
    ///
    /// This separation ensures that burned-account recovery is always
    /// intentional, admin-gated, and auditable on-chain separately from
    /// normal minting activity.
    pub fn admin_remint(
        env: Env,
        user: Address,
        initial_score: u32,
        history_hash: BytesN<32>,
    ) {
        // Admin-only — no minter bypass allowed for remints.
        Self::admin(&env).require_auth();
        Self::assert_not_paused(&env).unwrap();

        // Must be a previously burned account — not a first-time mint.
        let burned_key = DataKey::Burned(user.clone());
        if !env.storage().persistent().has(&burned_key) {
            panic!("nft not found");
        }

        // Require explicit prior approval even for admin.
        // approve_remint() must be called in a separate transaction first.
        let remint_approval_key = DataKey::RemintApproval(user.clone());
        if !env.storage().persistent().has(&remint_approval_key) {
            panic!("remint not approved");
        }

        // User must not already have an active NFT (sanity check).
        let metadata_key = DataKey::Metadata(user.clone());
        if env.storage().persistent().has(&metadata_key)
            || env
                .storage()
                .persistent()
                .has(&DataKey::Score(user.clone()))
        {
            panic!("nft already exists");
        }

        // Consume the one-time approval.
        env.storage().persistent().remove(&remint_approval_key);

        // Clear burned state and associated flags.
        env.storage().persistent().remove(&burned_key);
        env.storage()
            .persistent()
            .remove(&DataKey::Seized(user.clone()));
        env.storage()
            .persistent()
            .remove(&DataKey::TransferCooldown(user.clone()));

        // Write the new NFT metadata.
        let metadata = RemittanceMetadata {
            score: initial_score.min(Self::MAX_SCORE),
            history_hash,
        };
        env.storage().persistent().set(&metadata_key, &metadata);
        Self::bump_persistent_ttl(&env, &metadata_key);

        // Emit a distinct AdminRemint event — auditably separate from Mint events.
        env.events()
            .publish((symbol_short!("AdmRemint"), user.clone()), initial_score);
    }

    /// Get the metadata (score and history hash) for a user's NFT
    pub fn get_metadata(env: Env, user: Address) -> Option<RemittanceMetadata> {
        Self::get_or_migrate_metadata(&env, &user)
    }

    /// Get the score for a user.
    /// Returns 0 if the user has no NFT.
    pub fn get_score(env: Env, user: Address) -> u32 {
        Self::get_or_migrate_metadata(&env, &user)
            .map(|metadata| metadata.score)
            .unwrap_or(0)
    }

    /// Update the score for a user's NFT based on a repayment amount.
    pub fn update_score(
        env: Env,
        user: Address,
        repayment_amount: i128,
        minter: Option<Address>,
    ) {
        if repayment_amount <= 0 {
            panic!("invalid repayment amount");
        }
        Self::require_admin_or_authorized_minter(&env, minter).unwrap();

        let metadata_key = DataKey::Metadata(user.clone());
        let mut metadata =
            Self::get_or_migrate_metadata(&env, &user).expect("nft not found");

        // Simple logic: 1 point per 100 units of repayment
        let points_i128 = repayment_amount / 100;
        if points_i128 == 0 {
            return;
        }
        let points = if points_i128 > (Self::MAX_SCORE as i128) {
            Self::MAX_SCORE
        } else {
            points_i128 as u32
        };
        let old_score = metadata.score;
        metadata.score = old_score.saturating_add(points).min(Self::MAX_SCORE);

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
        Self::require_admin_or_authorized_minter(&env, minter)
            .unwrap_or_else(|_| panic!("unauthorized minter"));

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
        Self::append_score_history(&env, &user, old_score, new_score, symbol_short!("DEC"));
        env.events().publish(
            (symbol_short!("ScoreDecr"), user),
            (old_score, new_score, symbol_short!("PEN")),
        );
    }

    /// Update the history hash for a user's NFT.
    pub fn apply_score_delta(
        env: Env,
        user: Address,
        delta: i32,
        minter: Option<Address>,
    ) {
        Self::require_admin_or_authorized_minter(&env, minter).unwrap();

        let metadata_key = DataKey::Metadata(user.clone());
        let mut metadata =
            Self::get_or_migrate_metadata(&env, &user).expect("nft not found");

        let old_score = metadata.score as i64;
        let next_score = old_score + delta as i64;
        let bounded_score = next_score.clamp(0, Self::MAX_SCORE as i64);
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

    /// Update the history hash for a user's NFT.
    pub fn update_history_hash(
        env: Env,
        user: Address,
        new_history_hash: BytesN<32>,
        minter: Option<Address>,
    ) {
        Self::require_admin_or_authorized_minter(&env, minter).unwrap();

        if new_history_hash == BytesN::from_array(&env, &[0u8; 32]) {
            panic!("invalid history hash");
        }

        let metadata_key = DataKey::Metadata(user.clone());
        let mut metadata =
            Self::get_or_migrate_metadata(&env, &user).expect("nft not found");

        if metadata.history_hash == new_history_hash {
            panic!("invalid history hash");
        }
        metadata.history_hash = new_history_hash;

        env.storage().persistent().set(&metadata_key, &metadata);
        Self::bump_persistent_ttl(&env, &metadata_key);
        env.events().publish(
            (symbol_short!("HashUpd"), user),
            metadata.history_hash.clone(),
        );
    }

    /// Mark a borrower's collateral as seized.
    ///
    /// # Seized flag semantics
    /// The `seized` flag gates **new credit activity only**:
    /// - Blocks: new loan requests, new collateral deposits
    /// - Does NOT block: repayment of existing approved loans,
    ///   collateral release after full repayment, or score reads.
    ///
    /// This ensures that a seized borrower retains a path to clear
    /// their outstanding debt and avoid permanent bad-debt accumulation
    /// in the lending pool.
    pub fn seize_collateral(
        env: Env,
        user: Address,
        minter: Option<Address>,
    ) {
        Self::require_admin_or_authorized_minter(&env, minter).unwrap();

        let metadata_key = DataKey::Metadata(user.clone());
        if !env.storage().persistent().has(&metadata_key) {
            let score_key = DataKey::Score(user.clone());
            if !env.storage().persistent().has(&score_key) {
                panic!("nft not found");
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

    pub fn record_default(
        env: Env,
        user: Address,
        minter: Option<Address>,
    ) {
        Self::require_admin_or_authorized_minter(&env, minter).unwrap();

        if !Self::has_active_nft(&env, &user) {
            panic!("nft not found");
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
        Self::require_admin_or_authorized_minter(&env, minter).unwrap();

        if !Self::has_active_nft(&env, &user) {
            panic!("nft not found");
        }

        Self::burn_internal(&env, &user);
    }

    pub fn transfer(
        env: Env,
        from: Address,
        to: Address,
        minter: Option<Address>,
    ) {
        if from == to {
            panic!("self transfer");
        }

        from.require_auth();
        Self::require_admin_or_authorized_minter(&env, minter).unwrap();

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

        let metadata = Self::get_or_migrate_metadata(&env, &from).expect("nft not found");

        if Self::has_any_remittance_state(&env, &to) {
            panic!("destination occupied");
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

        Ok(())
    }

    /// Returns true if the borrower's collateral has been seized.
    /// See `seize_collateral` for the full list of operations this flag blocks.
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

    /// Grant one-time approval for a burned account to be re-minted.
    ///
    /// This must be called by the admin before `mint()` can succeed for a
    /// previously-burned user. The approval is consumed on use and cannot
    /// be reused — a new `approve_remint()` call is required for each
    /// subsequent remint attempt.
    ///
    /// Reverts with `ContractPaused` if the contract is paused.
    pub fn approve_remint(env: Env, user: Address) -> Result<(), NftError> {
        Self::admin(&env).require_auth();
        Self::assert_not_paused(&env)?;

        let approval_key = DataKey::RemintApproval(user);
        env.storage().persistent().set(&approval_key, &true);
        Self::bump_persistent_ttl(&env, &approval_key);
        Ok(())
    }

    pub fn set_default_burn_threshold(env: Env, threshold: u32) -> Result<(), NftError> {
        if threshold == 0 || threshold > Self::MAX_ALLOWED_BURN_THRESHOLD {
            return Err(NftError::InvalidThreshold);
        }
        Self::admin(&env).require_auth();
        Self::assert_not_paused(&env)?;

        env.storage()
            .instance()
            .set(&Self::burn_threshold_key(), &threshold);
        Self::bump_instance_ttl(&env);

        Ok(())
    }

    pub fn get_default_burn_threshold(env: Env) -> u32 {
        Self::default_burn_threshold(&env)
    }

    pub fn get_score_history(
        env: Env,
        user: Address,
        offset: u32,
        limit: u32,
    ) -> Vec<ScoreHistoryEntry> {
        let history = Self::get_score_history_or_default(&env, &user);
        let len = history.len();
        if offset >= len {
            return Vec::new(&env);
        }
        let mut page = Vec::new(&env);
        let end = (offset + limit).min(len);
        for idx in offset..end {
            page.push_back(history.get(idx).unwrap());
        }
        page
    }

    /// Get the number of ledgers remaining in a user's transfer cooldown.
    /// Returns 0 if no cooldown is active or the cooldown has expired.
    pub fn get_transfer_cooldown_remaining(env: Env, user: Address) -> u32 {
        let key = DataKey::TransferCooldown(user);
        if let Some(next_allowed_ledger) = env.storage().persistent().get::<DataKey, u32>(&key) {
            Self::bump_persistent_ttl(&env, &key);
            let current = env.ledger().sequence();
            if current < next_allowed_ledger {
                return next_allowed_ledger - current;
            }
        }
        0
    }

    /// Check if a remint approval exists for a user.
    pub fn is_remint_approved(env: Env, user: Address) -> bool {
        let key = DataKey::RemintApproval(user);
        let approved = env.storage().persistent().has(&key);
        if approved {
            Self::bump_persistent_ttl(&env, &key);
        }
        approved
    }

    pub fn is_paused(env: Env) -> bool {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    pub fn pause(env: Env) {
        Self::admin(&env).require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        Self::bump_instance_ttl(&env);
        env.events().publish((symbol_short!("Paused"),), ());
    }

    pub fn unpause(env: Env) {
        Self::admin(&env).require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        Self::bump_instance_ttl(&env);
        env.events().publish((symbol_short!("Unpaused"),), ());
    }

    pub fn get_admin(env: Env) -> Address {
        Self::admin(&env)
    }

    pub fn propose_admin(env: Env, new_admin: Address) {
        let current_admin = Self::admin(&env);
        current_admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::ProposedAdmin, &new_admin);
        Self::bump_instance_ttl(&env);

        env.events().publish(
            (Symbol::new(&env, "AdminProposed"), current_admin),
            new_admin,
        );
    }

    pub fn accept_admin(env: Env) -> Result<(), NftError> {
        let proposed_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::ProposedAdmin)
            .ok_or(NftError::NoProposedAdmin)?;
        proposed_admin.require_auth();

        env.storage()
            .instance()
            .set(&Self::admin_key(), &proposed_admin);
        env.storage().instance().remove(&DataKey::ProposedAdmin);
        Self::bump_instance_ttl(&env);

        env.events()
            .publish((Symbol::new(&env, "AdminTransferred"),), proposed_admin);
        Ok(())
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let current_admin = Self::admin(&env);
        current_admin.require_auth();

        env.storage().instance().set(&Self::admin_key(), &new_admin);
        env.storage().instance().remove(&DataKey::ProposedAdmin);
        Self::bump_instance_ttl(&env);

        env.events()
            .publish((Symbol::new(&env, "AdminTransferred"),), new_admin);
    }

    pub fn get_score_config(env: Env) -> ScoreConfig {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::ScoreConfig)
            .unwrap_or(ScoreConfig {
                repayment_delta: 15,
                default_penalty: 50,
            })
    }

    pub fn set_score_config(env: Env, config: ScoreConfig) -> Result<(), NftError> {
        Self::admin(&env).require_auth();
        Self::assert_not_paused(&env)?;

        env.storage().instance().set(&DataKey::ScoreConfig, &config);
        Self::bump_instance_ttl(&env);

        env.events()
            .publish((symbol_short!("ScoreCfg"),), (config.repayment_delta, config.default_penalty));
        Ok(())
    }
}

#[cfg(test)]
mod test;
