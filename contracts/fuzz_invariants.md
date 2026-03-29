# Fuzz Testing Invariants

This document defines the invariants that should always hold true for each contract in the remitlend system.

## LendingPool Contract

### Core Invariants

1. **Total Deposits >= Total Withdrawals**: The sum of all deposits should always be greater than or equal to the sum of all withdrawals.
2. **Individual Balance Invariant**: For any user, their balance should never be negative.
3. **Balance Consistency**: The sum of all individual user balances should equal the contract's token balance.
4. **Positive Amounts**: All deposit and withdrawal amounts must be positive.
5. **Authorization Invariant**: Only authorized users can withdraw from their own accounts.

### Edge Cases to Test

- Multiple rapid deposits and withdrawals
- Maximum value deposits/withdrawals
- Concurrent operations from multiple users
- Zero and near-zero amounts (should panic)
- Negative amounts (should panic)

## LoanManager Contract

### Core Invariants

1. **Score Threshold**: Users with scores below 500 should not be able to request loans.
2. **Score Non-Negative**: User scores should never be negative.
3. **Score Monotonicity**: Scores should only increase through legitimate repayments.
4. **Authorization Invariant**: Only authorized minters can update scores.
5. **Loan-Score Consistency**: Loan requests should be properly validated against user scores.

### Edge Cases to Test

- Loan requests with various score levels
- Score updates with different repayment amounts
- Unauthorized score update attempts
- Maximum score values
- Zero repayment amounts

## RemittanceNFT Contract

### Core Invariants

1. **Unique NFT per User**: Each user can only have one NFT.
2. **Score Range**: Scores should be within reasonable bounds (0 to some maximum).
3. **Authorization Invariant**: Only authorized minters can mint/update NFTs.
4. **Metadata Integrity**: History hash should be properly updated and maintained.
5. **Backward Compatibility**: Legacy score data should be properly migrated.

### Edge Cases to Test

- Duplicate minting attempts (should panic)
- Unauthorized minting/update attempts
- Score updates for non-existent users (should panic)
- History hash updates
- Migration from legacy format
- Maximum score values

## Cross-Contract Invariants

1. **Score Consistency**: Scores should be consistent across LoanManager and RemittanceNFT contracts.
2. **Token Flow**: Tokens should flow correctly between contracts and users.
3. **Authorization Chain**: Authorization should be properly maintained across contract interactions.

## Fuzzing Strategy

1. **Property-Based Testing**: Use random inputs to verify invariants hold
2. **State Machine Testing**: Test sequences of operations
3. **Boundary Testing**: Focus on edge cases and boundary conditions
4. **Concurrency Testing**: Test concurrent operations where applicable
5. **Malicious Input Testing**: Test with intentionally malformed inputs
