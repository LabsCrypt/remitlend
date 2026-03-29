# Storage Audit

## Summary

This audit reviewed all current Soroban storage usage across:

- `contracts/lending_pool`
- `contracts/loan_manager`
- `contracts/remittance_nft`

The current protocol stores only long-lived state:

- lender balances
- loan records
- loan counters
- contract configuration
- admin and authorized minter access
- remittance metadata and credit history

Because these values directly affect balances, permissions, or repayment state, they remain in
`persistent` or `instance` storage.

## Temporary Storage Review

Temporary storage is appropriate for short-lived, regenerable data such as:

- one-time session markers
- cached quote calculations
- expiring workflow checkpoints
- rate-limiting counters

No existing contract key currently satisfies those conditions without introducing the risk of
unexpected expiry changing protocol behavior. For that reason, this PR does not migrate any
existing business-critical key into `temporary` storage.

## Renewal Logic Added

To improve storage cost safety without weakening durability guarantees, this change adds renewal
helpers that extend TTL for:

- contract instance configuration
- persistent lender balances
- persistent loan records
- persistent remittance metadata and authorized minter state

This keeps long-lived protocol state renewable while preserving the correct storage class for each
key.
