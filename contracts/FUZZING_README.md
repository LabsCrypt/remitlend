# Fuzz Testing Setup for RemitLend Contracts

This document describes the comprehensive fuzz testing setup implemented for the RemitLend smart contracts.

> See [fuzz_invariants.md](fuzz_invariants.md) for the full definition of the invariants each fuzz target checks.

## Overview

Fuzz testing has been implemented to find edge cases and potential vulnerabilities in the RemitLend contracts that traditional unit tests might miss. The setup uses property-based testing to verify invariants across all contract operations.

## Architecture

### Framework Selection

Two fuzzing approaches have been implemented:

1. **cargo-fuzz** (libFuzzer-based) - For comprehensive fuzzing campaigns
2. **cargo-test-fuzz** - For property-based testing integrated with existing tests

### Contract Coverage

The fuzz testing covers all contracts in the system:

- **LendingPool**: Manages liquidity, share minting/redemption with virtual offsets, and loan disbursements
- **LoanManager**: Handles loan lifecycle, interest accrual, collateral, and defaults
- **RemittanceNFT**: Manages borrower reputation scores, remittance history, and transfer guards
- **MultisigGovernance**: Handles timelocked multi-sig admin handovers and contract upgrades

## Invariants Tested

The summary below is condensed; the complete, authoritative list is in [fuzz_invariants.md](fuzz_invariants.md).

### LendingPool Contract (v2 Share-Based Accounting)

1. **Asset-Liability Consistency (`TotalManagedAssets`)**: Internally tracked assets equal idle pool tokens plus `TotalOutstanding` principal deployed in loans. Unsolicited donations do not inflate share price (#1089).
2. **Share Price Monotonicity**: Share price is non-decreasing during standard operations and strictly increases upon yield distribution; virtual offsets protect first depositors.
3. **Total Outstanding Tracking**: `TotalOutstanding` increases on disbursement, decreases on repayment/liquidation, and never exceeds `TotalManagedAssets`.
4. **Typed Error Rejection**: Non-positive amounts and insufficient liquidity/shares return typed `PoolError` variants, never panic.
5. **Withdrawal Cooldown & Limits**: Early redemptions enforce withdrawal cooldown periods; utilization is capped at 100%.
6. **Authorization Chains**: `disburse_loan` is restricted to the authorized LoanManager contract address.

### LoanManager Contract

1. **Score Threshold & Bounds**: Scores strictly adhere to the 300–850 band; borrowers below `min_score` (default 500) are rejected with `LoanError::ScoreTooLow`.
2. **Borrower Loan Cap**: Active loan count is capped at `max_loans_per_borrower`.
3. **Accrual Index Consistency (#1382)**: Interest and late fee accruals follow ledger-based formulas; repayments follow strict late fee -> interest -> principal order; penalties are capped.
4. **7-State Lifecycle Invariant**: Loans transition strictly across valid states (`Pending`, `Approved`, `Repaid`, `Defaulted`, `Liquidated`, `Cancelled`, `Rejected`).
5. **Collateral Invariant**: Collateral remains locked during active loan lifetime; released on full repayment; seized on default/liquidation.
6. **Authorization & Errors**: Administrative actions require admin authentication; invalid inputs return typed `LoanError`.

### RemittanceNFT Contract

1. **Unique Metadata Record per Borrower**: Each borrower address maintains at most one metadata record.
2. **Score Range Invariant**: Credit scores are bounded to [300, 850]; invalid values return typed `ContractError::ScoreOutOfRange`.
3. **Minter Authorization**: Minting and score updates require admin or authorized minter permission.
4. **Score History & Hash Monotonicity**: Every score change appends an immutable `ScoreHistoryEntry` and updates remittance `history_hash`.
5. **Active-Loan Transfer Guard**: NFTs cannot be transferred while borrower has active loans in LoanManager.

### MultisigGovernance Contract

1. **Quorum & Threshold Enforcement**: Finalization requires `approvals >= threshold` where `1 <= threshold <= signers.len()`.
2. **Timelock Delay Enforcement**: Proposals cannot be finalized before `executable_after = proposed_at + timelock_delay`.
3. **Single Pending Proposal**: At most one admin transfer proposal can be pending at a time.
4. **Signer Idempotency**: Only registered signers can approve proposals; duplicate approvals are idempotent.
5. **Emergency Cancellation**: Authorized signers or admin can emergency cancel pending proposals prior to execution.

## Pull Request Template

When opening a PR for fuzz testing changes, use the fuzzing-specific PR template instead of the default one. GitHub does not auto-select it, so append the `template` query parameter to the compare URL:

```
https://github.com/<org>/<repo>/compare/main...<your-branch>?template=PR_TEMPLATE_FUZZING.md
```

The template lives at `.github/PULL_REQUEST_TEMPLATE/PR_TEMPLATE_FUZZING.md` and covers invariants, fuzz targets, and campaign results.

## Setup Instructions

### Prerequisites

1. Install Rust toolchain (stable)
2. Install fuzzing tools:
   ```bash
   cargo install cargo-fuzz
   cargo install cargo-test-fuzz
   ```

### Running Fuzz Tests

#### Option 1: Using cargo-test-fuzz (Recommended for development)

```bash
# Run fuzz tests for lending pool
cd contracts/lending_pool
cargo test-fuzz --test test_deposit_withdraw_invariants --run-until-crash

# List available fuzz targets
cargo test-fuzz --list
```

#### Option 2: Using cargo-fuzz (For comprehensive campaigns)

```bash
# Run the fuzz campaign script
cd contracts
./fuzz_campaign.sh

# Or run individual targets
cargo fuzz run lending_pool_fuzz
cargo fuzz run loan_manager_fuzz
cargo fuzz run remittance_nft_fuzz
```

### Customizing Fuzz Campaigns

The `fuzz_campaign.sh` script can be customized:

```bash
# Run with custom duration (seconds)
./fuzz_campaign.sh 300

# Results are saved to:
# - fuzz/reports/ - Summary reports
# - fuzz/artifacts/ - Crash artifacts
# - fuzz/corpus/ - Input corpus
```

## File Structure

```
contracts/
├── fuzz_invariants.md              # Detailed invariant definitions
├── fuzz_campaign.sh               # Campaign execution script
├── fuzz/                          # cargo-fuzz setup
│   ├── Cargo.toml                 # Fuzz dependencies
│   └── fuzz_targets/
│       ├── lending_pool_fuzz.rs    # LendingPool fuzz target
│       ├── loan_manager_fuzz.rs    # LoanManager fuzz target
│       └── remittance_nft_fuzz.rs # RemittanceNFT fuzz target
├── lending_pool/
│   ├── Cargo.toml                 # Updated with test-fuzz deps
│   └── src/test.rs               # Includes fuzz test
├── loan_manager/
│   └── Cargo.toml                 # Ready for test-fuzz integration
└── remittance_nft/
    └── Cargo.toml                 # Ready for test-fuzz integration
```

## Implementation Details

### Fuzz Target Design

Each fuzz target implements:

1. **Arbitrary Input Generation**: Uses the `arbitrary` crate for structured random inputs
2. **Environment Setup**: Mock Soroban environment with necessary contracts
3. **Invariant Verification**: Checks invariants after each operation
4. **Panic Handling**: Catches and analyzes expected panics

### Property-Based Testing

The `test_fuzz` attribute enables property-based testing:

```rust
#[test_fuzz]
fn test_deposit_withdraw_invariants(operation: FuzzOperation) {
    // Test implementation with invariant checks
}
```

### State Machine Testing

Complex operations are tested using state machine patterns:

```rust
enum FuzzAction {
    Deposit { user_id: u64, amount: i128 },
    Withdraw { user_id: u64, amount: i128 },
    MultipleOperations { operations: Vec<Operation> },
}
```

## Analysis and Results

### Expected Outcomes

1. **No Crashes**: All invariants should hold under random inputs
2. **Panic Verification**: Expected panics should occur for invalid inputs
3. **Performance**: Fuzzing should complete within reasonable time

### Interpreting Results

- **Crash Artifacts**: Input values that cause contract panics
- **Coverage Reports**: Code paths exercised during fuzzing
- **Performance Metrics**: Execution time and iterations per second

### Continuous Integration

The fuzzing setup is designed for CI integration:

```yaml
# Example GitHub Actions workflow
- name: Run Fuzz Tests
  run: |
    cd contracts
    ./fuzz_campaign.sh 60
```

## Best Practices

1. **Regular Fuzzing**: Run fuzz tests regularly, especially after contract changes
2. **Corpus Management**: Save interesting inputs to corpus for future testing
3. **Invariant Updates**: Review and update invariants as contracts evolve
4. **Crash Analysis**: Investigate all crashes to determine if they represent bugs or expected behavior
5. **Performance Monitoring**: Track fuzzing performance to detect regressions

## Troubleshooting

### Common Issues

1. **Nightly Compiler Required**: cargo-fuzz requires nightly Rust

   ```bash
   rustup install nightly
   rustup default nightly
   ```

2. **Missing Dependencies**: Ensure all fuzzing tools are installed

   ```bash
   cargo install cargo-fuzz cargo-test-fuzz cargo-afl
   ```

3. **Workspace Configuration**: Fuzz directory is excluded from workspace to avoid conflicts

### Debugging Tips

1. Use `RUST_BACKTRACE=1` for detailed error information
2. Check crash artifacts in `fuzz/artifacts/` directory
3. Review logs in `fuzz/reports/` for detailed analysis

## Future Enhancements

1. **Cross-Contract Fuzzing**: Test interactions between contracts
2. **Stateful Fuzzing**: More sophisticated state machine testing
3. **Coverage-Guided Fuzzing**: Use coverage information to guide input generation
4. **Regression Testing**: Automated regression detection for known issues
5. **Performance Fuzzing**: Test for gas limit and performance issues

## Contributing

When adding new contracts or features:

1. Define relevant invariants in `fuzz_invariants.md`
2. Implement corresponding fuzz tests
3. Update the campaign script if needed
4. Document new invariants and test cases
5. Run full fuzz campaign before submitting PR

## Security Considerations

Fuzz testing helps identify:

1. **Integer Overflows**: Boundary conditions in arithmetic operations
2. **Authorization Bypasses**: Improper access control
3. **State Corruption**: Invalid state transitions
4. **Resource Exhaustion**: Denial-of-service vectors
5. **Logic Errors**: Business rule violations

Regular fuzz testing should be part of the security review process for all contract changes.
