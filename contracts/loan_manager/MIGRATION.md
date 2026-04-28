# LoanManager Contract Migration Strategy

This document outlines the migration strategy for LoanManager contract upgrades.

## Overview

The `migrate()` function is responsible for:
1. Initializing new storage keys with defaults when upgrading to a new contract version
2. Performing any necessary data transformations
3. Preventing double-execution of migrations for the same version

## Current Migrations

### Version 4

The current version includes migrations for:
- `LateFeeRateBps` - Late fee rate configuration
- `LiquidationThresholdBps` - Threshold for loan liquidation
- `LiquidationBonusBps` - Bonus paid to liquidators (with MAX_LIQUIDATION_BONUS_BPS = 2000 cap)
- `RateOracle` - Optional oracle address for dynamic interest rates
- `MinRateBps` / `MaxRateBps` - Bounds on interest rate calculations

## Migration Guard

Each migration is guarded by:
1. **Version Tracking**: The contract stores the last migrated version in `DataKey::MigratedVersion`
2. **Idempotency**: The `migrate()` function checks if we're already at the current version before executing
3. **Single-Execution**: If `MigratedVersion >= CURRENT_VERSION`, the migration is skipped

This prevents:
- Double-execution of migrations
- Data corruption from re-running migrations
- Admin errors from calling `migrate()` multiple times

## Adding New Migrations

When adding a new contract version:

1. Increment `CURRENT_VERSION`
2. Add migration logic in `migrate()` function to initialize new storage keys
3. Use `if !env.storage().instance().has(&DataKey::NewKey)` pattern to safely add new fields
4. Transformation logic can be added within each check
5. The migration guard automatically prevents re-execution

## Schema Evolution

### Data Structure Changes

If a field in an existing struct needs to be renamed or its type changed:
1. Create a new DataKey for the new structure
2. In `migrate()`, read from old DataKey, transform, and write to new DataKey
3. Optionally keep the old key for backward compatibility
4. Document the change in migration notes

### Storage Key Renames

If a DataKey needs to be renamed:
1. Create migration logic to copy data from old key to new key
2. Update all references to use the new key
3. Old key data can be cleaned up in a subsequent migration (optional)

## Testing Migrations

When testing a migration:
1. Create a test that deploys the old contract version
2. Initialize data using the old schema
3. Deploy the new contract version
4. Call `migrate()`
5. Verify all data is readable using the new contract's getters
6. Verify the migration cannot be called twice

Example test pattern:
```rust
#[test]
fn test_migration_from_v3_to_v4() {
    // Deploy old version, create data
    // Upgrade to new version
    // Call migrate()
    // Verify data integrity
}
```

## Emergency Rollback

If a migration fails or needs to be rolled back:
1. Redeploy the previous contract version (requires new contract ID)
2. Manually recover data from on-chain storage if needed
3. Test migration thoroughly on testnet before re-attempting on mainnet

## Version History

- **v4**: Initial structured migration with guard mechanism
  - Added rate bounds (MIN_RATE_BPS, MAX_RATE_BPS)
  - Added liquidation bonus cap (MAX_LIQUIDATION_BONUS_BPS = 2000)
  - Migration guard prevents double-execution
