#![no_std]

use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Symbol};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum VaultError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    InvalidPrice = 4,
    AuctionNotFound = 5,
    AuctionClosed = 6,
    BidTooLow = 7,
    NoProposedAdmin = 8,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AuctionStatus {
    Open,
    Settled,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Auction {
    pub seller: Address,
    pub stable_token: Address,
    pub collateral_token: Address,
    pub proceeds_recipient: Address,
    pub collateral_amount: i128,
    pub start_price: i128,
    pub floor_price: i128,
    pub price_step: i128,
    pub step_ledgers: u32,
    pub start_ledger: u32,
    pub status: AuctionStatus,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    ProposedAdmin,
    AuctionCounter,
    Auction(u32),
    Recovered(Address),
    Version,
}

#[contract]
pub struct LiquidationVault;

#[contractimpl]
impl LiquidationVault {
    const CURRENT_VERSION: u32 = 1;
    const INSTANCE_TTL_THRESHOLD: u32 = 17_280;
    const INSTANCE_TTL_BUMP: u32 = 518_400;
    const PERSISTENT_TTL_THRESHOLD: u32 = 17_280;
    const PERSISTENT_TTL_BUMP: u32 = 518_400;

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
            .get(&DataKey::Admin)
            .expect("not initialized")
    }

    fn read_counter(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::AuctionCounter)
            .unwrap_or(0)
    }

    fn read_auction(env: &Env, auction_id: u32) -> Result<Auction, VaultError> {
        let key = DataKey::Auction(auction_id);
        let auction = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(VaultError::AuctionNotFound)?;
        Self::bump_persistent_ttl(env, &key);
        Ok(auction)
    }

    fn write_auction(env: &Env, auction_id: u32, auction: &Auction) {
        let key = DataKey::Auction(auction_id);
        env.storage().persistent().set(&key, auction);
        Self::bump_persistent_ttl(env, &key);
    }

    pub fn initialize(env: Env, admin: Address) -> Result<(), VaultError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(VaultError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::AuctionCounter, &0u32);
        env.storage()
            .instance()
            .set(&DataKey::Version, &Self::CURRENT_VERSION);
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    pub fn version(env: Env) -> u32 {
        Self::bump_instance_ttl(&env);
        env.storage().instance().get(&DataKey::Version).unwrap_or(0)
    }

    pub fn start_auction(
        env: Env,
        seller: Address,
        stable_token: Address,
        collateral_token: Address,
        proceeds_recipient: Address,
        collateral_amount: i128,
        start_price: i128,
        floor_price: i128,
        price_step: i128,
        step_ledgers: u32,
    ) -> Result<u32, VaultError> {
        seller.require_auth();
        if collateral_amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }
        if start_price <= 0 || floor_price <= 0 || start_price < floor_price || price_step <= 0 {
            return Err(VaultError::InvalidPrice);
        }
        if step_ledgers == 0 {
            return Err(VaultError::InvalidPrice);
        }

        TokenClient::new(&env, &collateral_token).transfer(
            &seller,
            &env.current_contract_address(),
            &collateral_amount,
        );

        let auction_id = Self::read_counter(&env)
            .checked_add(1)
            .expect("auction counter overflow");
        env.storage()
            .instance()
            .set(&DataKey::AuctionCounter, &auction_id);

        let auction = Auction {
            seller: seller.clone(),
            stable_token: stable_token.clone(),
            collateral_token: collateral_token.clone(),
            proceeds_recipient: proceeds_recipient.clone(),
            collateral_amount,
            start_price,
            floor_price,
            price_step,
            step_ledgers,
            start_ledger: env.ledger().sequence(),
            status: AuctionStatus::Open,
        };
        Self::write_auction(&env, auction_id, &auction);
        env.events().publish(
            (Symbol::new(&env, "AuctionStarted"), seller, collateral_token),
            (
                auction_id,
                stable_token,
                proceeds_recipient,
                collateral_amount,
                start_price,
            ),
        );
        Ok(auction_id)
    }

    pub fn current_price(env: Env, auction_id: u32) -> Result<i128, VaultError> {
        let auction = Self::read_auction(&env, auction_id)?;
        let elapsed = env.ledger().sequence().saturating_sub(auction.start_ledger);
        let steps = elapsed / auction.step_ledgers;
        let discount = auction
            .price_step
            .checked_mul(steps as i128)
            .expect("price discount overflow");
        Ok(auction.start_price.saturating_sub(discount).max(auction.floor_price))
    }

    pub fn bid(
        env: Env,
        bidder: Address,
        auction_id: u32,
        max_price: i128,
    ) -> Result<(), VaultError> {
        bidder.require_auth();
        let mut auction = Self::read_auction(&env, auction_id)?;
        if auction.status != AuctionStatus::Open {
            return Err(VaultError::AuctionClosed);
        }

        let price = Self::current_price(env.clone(), auction_id)?;
        if max_price < price {
            return Err(VaultError::BidTooLow);
        }

        TokenClient::new(&env, &auction.stable_token).transfer(
            &bidder,
            &auction.proceeds_recipient,
            &price,
        );
        TokenClient::new(&env, &auction.collateral_token).transfer(
            &env.current_contract_address(),
            &bidder,
            &auction.collateral_amount,
        );

        auction.status = AuctionStatus::Settled;
        Self::write_auction(&env, auction_id, &auction);

        let recovered_key = DataKey::Recovered(auction.stable_token.clone());
        let recovered: i128 = env.storage().instance().get(&recovered_key).unwrap_or(0);
        env.storage().instance().set(
            &recovered_key,
            &recovered.checked_add(price).expect("recovered overflow"),
        );
        env.events().publish(
            (Symbol::new(&env, "AuctionSettled"), bidder, auction.stable_token),
            (
                auction_id,
                auction.proceeds_recipient,
                price,
                auction.collateral_amount,
            ),
        );
        Ok(())
    }

    pub fn get_auction(env: Env, auction_id: u32) -> Result<Auction, VaultError> {
        Self::read_auction(&env, auction_id)
    }

    pub fn recovered(env: Env, stable_token: Address) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::Recovered(stable_token))
            .unwrap_or(0)
    }

    pub fn propose_admin(env: Env, new_admin: Address) {
        Self::admin(&env).require_auth();
        env.storage()
            .instance()
            .set(&DataKey::ProposedAdmin, &new_admin);
        Self::bump_instance_ttl(&env);
    }

    pub fn accept_admin(env: Env) -> Result<(), VaultError> {
        let proposed: Address = env
            .storage()
            .instance()
            .get(&DataKey::ProposedAdmin)
            .ok_or(VaultError::NoProposedAdmin)?;
        proposed.require_auth();
        env.storage().instance().set(&DataKey::Admin, &proposed);
        env.storage().instance().remove(&DataKey::ProposedAdmin);
        Self::bump_instance_ttl(&env);
        Ok(())
    }
}

#[cfg(test)]
mod test;
