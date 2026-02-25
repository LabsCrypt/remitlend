#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env};

#[contracttype]
#[derive(Clone)]
pub struct RemittanceMetadata {
    pub score: u32,
    pub history_hash: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Metadata(Address),
    Score(Address), // Legacy key for backward compatibility
    AuthorizedMinter(Address),
}

#[contract]
pub struct RemittanceNFT;

#[contractimpl]
impl RemittanceNFT {
    fn admin_key() -> soroban_sdk::Symbol {
        symbol_short!("ADMIN")
    }

    fn admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&Self::admin_key())
            .expect("not initialized")
    }

    fn require_admin_or_authorized_minter(env: &Env, minter: Option<Address>) {
        if let Some(minter_addr) = minter {
            minter_addr.require_auth();
            if !env
                .storage()
                .persistent()
                .has(&DataKey::AuthorizedMinter(minter_addr))
            {
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
            env.storage().persistent().remove(&score_key);
            return Some(migrated_metadata);
        }

        None
    }

    pub fn initialize(env: Env, admin: Address) {
        let admin_key = Self::admin_key();
        if env.storage().instance().has(&admin_key) {
            panic!("already initialized");
        }
        env.storage().instance().set(&admin_key, &admin);
        // Admin is automatically authorized to mint
        env.storage()
            .persistent()
            .set(&DataKey::AuthorizedMinter(admin.clone()), &true);
    }
    /// Authorize a contract or account to mint NFTs
    pub fn authorize_minter(env: Env, minter: Address) {
        Self::admin(&env).require_auth();

        env.storage()
            .persistent()
            .set(&DataKey::AuthorizedMinter(minter), &true);
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
        env.storage()
            .persistent()
            .has(&DataKey::AuthorizedMinter(minter))
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
        Self::require_admin_or_authorized_minter(&env, minter);

        let metadata_key = DataKey::Metadata(user.clone());
        let score_key = DataKey::Score(user.clone());

        // Check if user already has an NFT (either new format or legacy)
        if env.storage().persistent().has(&metadata_key)
            || env.storage().persistent().has(&score_key)
        {
            panic!("user already has an NFT");
        }

        let metadata = RemittanceMetadata {
            score: initial_score,
            history_hash,
        };

        env.storage().persistent().set(&metadata_key, &metadata);
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
        metadata.score = metadata.score.checked_add(points).expect("score overflow");

        env.storage().persistent().set(&metadata_key, &metadata);
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
    }
}

mod test;
