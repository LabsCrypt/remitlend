# Fuzz Testing Setup for RemitLend Contracts

This document describes the comprehensive fuzz testing setup implemented for the RemitLend smart contracts.

## Overview

Fuzz testing has been implemented to find edge cases and potential vulnerabilities in the RemitLend contracts that traditional unit tests might miss. The setup uses property-based testing to verify invariants across all contract operations.

## Architecture

### Framework Selection

Two fuzzing approaches have been implemented:

1. **cargo-fuzz** (libFuzzer-based) - For comprehensive fuzzing campaigns
2. **cargo-test-fuzz** - For property-based testing integrated with existing tests

### Contract Coverage

The fuzz testing covers all three main contracts:

- **LendingPool**: Manages deposits and withdrawals
- **LoanManager**: Handles loan requests and repayments
- **RemittanceNFT**: Manages user reputation scores and NFTs

## Invariants Tested

### LendingPool Contract

1. **Total Deposits >= Total Withdrawals**: The sum of all deposits should always be greater than or equal to the sum of all withdrawals
2. **Individual Balance Invariant**: For any user, their balance should never be negative
3. **Balance Consistency**: The sum of all individual user balances should equal the contract's token balance
4. **Positive Amounts**: All deposit and withdrawal amounts must be positive
5. **Authorization Invariant**: Only authorized users can withdraw from their own accounts

### LoanManager Contract

1. **Score Threshold**: Users with scores below 500 should not be able to request loans
2. **Score Non-Negative**: User scores should never be negative
3. **Score Monotonicity**: Scores should only increase through legitimate repayments
4. **Authorization Invariant**: Only authorized minters can update scores
5. **Loan-Score Consistency**: Loan requests should be properly validated against user scores

### RemittanceNFT Contract

1. **Unique NFT per User**: Each user can only have one NFT
2. **Score Range**: Scores should be within reasonable bounds (0 to maximum)
3. **Authorization Invariant**: Only authorized minters can mint/update NFTs
4. **Metadata Integrity**: History hash should be properly updated and maintained
5. **Backward Compatibility**: Legacy score data should be properly migrated

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
