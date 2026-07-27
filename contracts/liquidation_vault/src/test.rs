use crate::{AuctionStatus, LiquidationVault, LiquidationVaultClient, VaultError};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{Address, Env};

fn create_token_contract<'a>(
    env: &Env,
    admin: &Address,
) -> (Address, StellarAssetClient<'a>, TokenClient<'a>) {
    let contract_id = env.register_stellar_asset_contract_v2(admin.clone());
    let stellar_asset_client = StellarAssetClient::new(env, &contract_id.address());
    let token_client = TokenClient::new(env, &contract_id.address());
    (contract_id.address(), stellar_asset_client, token_client)
}

#[test]
fn test_default_collateral_routes_to_auction_and_bid_rebalances_pool() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let seller = Address::generate(&env);
    let liquidator = Address::generate(&env);
    let lending_pool = Address::generate(&env);

    let (stable_token, stable_asset, stable_client) = create_token_contract(&env, &admin);
    let (collateral_token, collateral_asset, collateral_client) =
        create_token_contract(&env, &admin);

    collateral_asset.mint(&seller, &500);
    stable_asset.mint(&liquidator, &10_000);

    let vault_id = env.register(LiquidationVault, ());
    let vault = LiquidationVaultClient::new(&env, &vault_id);
    vault.initialize(&admin);

    let auction_id = vault.start_auction(
        &seller,
        &stable_token,
        &collateral_token,
        &lending_pool,
        &500,
        &1_000,
        &600,
        &100,
        &5,
    );

    assert_eq!(collateral_client.balance(&seller), 0);
    assert_eq!(collateral_client.balance(&vault_id), 500);

    env.ledger().set_sequence_number(11);
    assert_eq!(vault.current_price(&auction_id), 800);

    vault.bid(&liquidator, &auction_id, &800);

    let auction = vault.get_auction(&auction_id);
    assert_eq!(auction.status, AuctionStatus::Settled);
    assert_eq!(stable_client.balance(&lending_pool), 800);
    assert_eq!(collateral_client.balance(&liquidator), 500);
    assert_eq!(vault.recovered(&stable_token), 800);
}

#[test]
fn test_bid_below_dutch_price_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let seller = Address::generate(&env);
    let liquidator = Address::generate(&env);
    let lending_pool = Address::generate(&env);

    let (stable_token, stable_asset, _stable_client) = create_token_contract(&env, &admin);
    let (collateral_token, collateral_asset, _collateral_client) =
        create_token_contract(&env, &admin);
    collateral_asset.mint(&seller, &500);
    stable_asset.mint(&liquidator, &10_000);

    let vault_id = env.register(LiquidationVault, ());
    let vault = LiquidationVaultClient::new(&env, &vault_id);
    vault.initialize(&admin);
    let auction_id = vault.start_auction(
        &seller,
        &stable_token,
        &collateral_token,
        &lending_pool,
        &500,
        &1_000,
        &600,
        &100,
        &5,
    );

    assert_eq!(
        vault.try_bid(&liquidator, &auction_id, &999),
        Err(Ok(VaultError::BidTooLow))
    );
}
