# Fuzz Testing Invariants

This document defines the invariants that should always hold true for each contract in the RemitLend system under the v2 share-based accounting model.

For how to set up and run the fuzz targets that check these invariants, see [FUZZING_README.md](FUZZING_README.md).

---

## 1. LendingPool Contract (v2 Share-Based Accounting)

### Core Invariants

1. **Asset-Liability Consistency (`TotalManagedAssets`)**:
   `TotalManagedAssets` internally tracks total assets (idle token balance in the pool + `TotalOutstanding` active principal deployed in loans).
   - `TotalManagedAssets` is mutated strictly through `deposit`, `redeem`/`withdraw`, and `distribute_yield`.
   - Direct unsolicited token transfers ("donations") do not increment `TotalManagedAssets` and cannot artificially manipulate share pricing (#1089).
   - At all times: `TotalManagedAssets >= total_deposits` (when yield >= 0) and `TotalOutstanding <= TotalManagedAssets`.

2. **Share Price Monotonicity & Virtual Offset Inflation Defense**:
   - The share conversion formula incorporates virtual offsets (`virtual_assets` and `virtual_shares`) to prevent empty-pool donation attacks (#1089).
   - In the absence of realized defaults or slashing, share price (`total_managed_assets / total_shares`) is monotonically non-decreasing over time and strictly increasing upon `distribute_yield`.

3. **Total Outstanding Principal Tracking**:
   - `TotalOutstanding` records the total principal deployed in active loans.
   - `TotalOutstanding` increases solely via `disburse_loan` (called by LoanManager).
   - `TotalOutstanding` decreases via `repay_loan_principal` and `adjust_outstanding` (called by LoanManager on repayment, default, or liquidation).
   - `TotalOutstanding` can never be negative.

4. **Typed Error Rejection (No Panics on Invalid Input)**:
   - Operations with non-positive amounts (`amount <= 0`) return typed errors (`PoolError::InvalidAmount` or `PoolError::ZeroShares`), never panic.
   - Withdrawals exceeding available idle liquidity or active shares return typed errors (`PoolError::InsufficientBalance`, `PoolError::InsufficientLiquidity`), never unhandled panics.

5. **Withdrawal Cooldown & Liquidity Constraints**:
   - Withdrawals requested before the expiration of the configured cooldown window return `PoolError::WithdrawalCooldownActive`.
   - Pool utilization cannot exceed 100% (10,000 basis points): `TotalOutstanding <= TotalDeposits`.

6. **Authorization Chains**:
   - `disburse_loan` and `repay_loan_principal` are gated strictly to the registered `LoanManager` contract address (`PoolError::Unauthorized`).
   - Administrative functions (`set_loan_manager`, `set_max_pool_size`, `set_withdrawal_cooldown`, `pause`, `unpause`) require admin authentication.

### Edge Cases to Test

- Consecutive deposits and immediate redeems with virtual offsets
- First-depositor share price manipulation attempts (donation attacks)
- Concurrent multi-user deposits, disbursements, and repayments
- Zero and negative amounts (must return typed `PoolError`, not panic)
- Boundary condition withdrawals equal to exact available liquidity
- Unauthorized invocation of `disburse_loan` or `repay_loan_principal`

---

## 2. LoanManager Contract

### Core Invariants

1. **Score Threshold & Band Enforcement**:
   - Credit scores are bounded to the standard credit band: `300 <= score <= 850`.
   - Borrowers with scores below `min_score` (default 500) are rejected with typed error `LoanError::ScoreTooLow`.
   - Loan requests exceeding `max_loan_amount` fail with `LoanError::AmountExceedsMax`.

2. **Borrower Active Loan Cap**:
   - A borrower cannot have more active loans than `max_loans_per_borrower`. Subsequent loan requests fail with `LoanError::MaxLoansExceeded` until existing loans are repaid or resolved.

3. **Accrual Index Consistency (#1382)**:
   - Interest and late fees accrue strictly as functions of elapsed ledgers:
     `accrued_interest = (principal * interest_rate_bps * elapsed_ledgers) / (10_000 * LEDGERS_PER_YEAR)`.
   - Repayments follow strict waterfall allocation: `accrued_late_fee` -> `accrued_interest` -> `principal`.
   - Late fee rates and penalties respect bounded limits (`MAX_PENALTY_MULTIPLIER` and `max_rate_bps`).
   - Principal outstanding decreases monotonically with each valid repayment.

4. **Loan Lifecycle State Transitions**:
   - Valid lifecycle transitions:
     - `Pending` -> `Approved` (via `approve_loan` / `approve_loans_batch`)
     - `Pending` -> `Cancelled` (via `cancel_loan`)
     - `Pending` -> `Rejected` (via `reject_loan`)
     - `Approved` -> `Repaid` (via `repay`)
     - `Approved` -> `Defaulted` (via `check_default` / `check_defaults` past grace period)
     - `Approved` -> `Liquidated` (via `liquidate` when undercollateralized)
   - Disallowed transitions (e.g. `Repaid` -> `Defaulted`, `Cancelled` -> `Approved`) return typed errors (`LoanError::LoanNotPending`, `LoanError::LoanAlreadyRepaid`, etc.).

5. **Collateral Invariant**:
   - Collateral deposited via `deposit_collateral` remains locked in the contract while the loan is in `Pending` or `Approved` status.
   - Upon full repayment (`principal == 0`), collateral is automatically released to the borrower.
   - Upon default or liquidation, collateral is seized or transferred to the liquidator/pool.

6. **Authorization & Error Guarantees**:
   - Admin functions (`approve_loan`, `reject_loan`, `set_*`) require admin authentication.
   - Invalid or unauthorized requests return typed `LoanError`, never unhandled panic.

### Edge Cases to Test

- Boundary scores: 299 (rejected), 300 (accepted), 850 (accepted), 851 (rejected)
- Repayments split between late fees, interest, and principal
- Repayment of zero or sub-minimum amounts (returns `LoanError::AmountBelowMinimum`)
- Default checks before due date, during grace period, and after default window
- Collateral seizure and liquidation with varying health factors

---

## 3. RemittanceNFT Contract

### Core Invariants

1. **Unique Metadata Record per Borrower**:
   - Each borrower `Address` has at most one credit metadata record stored under `DataKey::Metadata(Address)`.
   - Duplicate minting for an existing borrower returns typed error `ContractError::AlreadyMinted`.

2. **Score Range Invariant**:
   - Valid scores strictly conform to the 300–850 range (`MIN_SCORE = 300`, `MAX_SCORE = 850`).
   - Score updates outside this range return typed error `ContractError::ScoreOutOfRange`, never panic.

3. **Minter Authorization**:
   - Only authorized addresses (`DataKey::AuthorizedMinter(Address)`) or contract admin can call `mint`, `update_score`, or `apply_score_delta`.
   - Unauthorized callers are rejected with `ContractError::Unauthorized`.

4. **Metadata & Score History Monotonicity**:
   - Every score alteration appends an immutable `ScoreHistoryEntry` containing ledger sequence, old score, new score, and reason symbol.
   - Remittance `history_hash` (`BytesN<32>`) updates deterministically with each verified remittance cycle.

5. **Active-Loan Transfer Guard**:
   - Borrower NFTs cannot be transferred while the borrower has active or pending loans in `LoanManager` (`ContractError::LoanActive`).
   - Transfers respect configured cooldown periods (`get_transfer_cooldown_remaining`).

### Edge Cases to Test

- Score deltas that would underflow (< 300) or overflow (> 850) (clamped or rejected with typed error)
- Multiple rapid score updates from concurrent authorized minters
- Transfer attempts while borrower has pending or approved loans
- Revocation of minter permissions during inflight transactions

---

## 4. Multisig Governance Contract

### Core Invariants

1. **Quorum & Threshold Enforcement**:
   - Admin transfers and contract upgrades cannot be finalized unless:
     `approval_count >= threshold`, where `1 <= threshold <= signers.len()`.
   - `finalize_admin_transfer` returns `GovernanceError::ThresholdNotMet` if approvals are insufficient.

2. **Timelock Delay Enforcement**:
   - Proposals cannot be executed before `executable_after = proposed_at + timelock_delay`.
   - Early execution attempts return `GovernanceError::TimelockNotExpired`.

3. **Single Pending Proposal Lifecycle**:
   - Only one admin transfer proposal can be pending at any time (`has_pending_transfer`).
   - New proposals while one is pending return `GovernanceError::ProposalAlreadyPending`.
   - Proposals past their time-to-live can be expired via `expire_proposal`, releasing the slot for subsequent proposals.

4. **Signer Quorum & Approval Idempotency**:
   - Only registered signers can approve proposals (`GovernanceError::NotSigner`).
   - Approvals from the same signer are idempotent (duplicate approvals do not double count).

5. **Emergency Cancellation**:
   - Authorized signers or admin can invoke `emergency_cancel_proposal` at any time prior to execution, transitioning the proposal to `Cancelled` and preventing finalization.

### Edge Cases to Test

- Finalization attempts exactly at `executable_after - 1` second (fails) vs `executable_after` (succeeds)
- Signer approvals submitted after proposal has been cancelled or expired (fails)
- Threshold configuration edge cases: `threshold = 1`, `threshold = signers.len()`
- Re-proposal immediately after cancellation vs after cooldown window

---

## 5. Cross-Contract Invariants

1. **Disbursement & Pool Accounting Sync**:
   - When `LoanManager::approve_loan` disburses `amount` through `LendingPool::disburse_loan`, `LendingPool::TotalOutstanding` increases by exactly `amount`.
   - Idle pool balance decreases by `amount`, while `TotalManagedAssets` remains conserved.

2. **Repayment & Pool Balance Flow**:
   - Principal repayments decrease `TotalOutstanding` and increase idle pool token balance by the exact principal portion.
   - Interest payments increase `TotalManagedAssets` and contribute to pool yield distribution.

3. **Repayment & Credit Score Synchronization**:
   - On-time loan full repayments invoke `RemittanceNFT::apply_score_delta` with a positive score reward.
   - Defaults invoke `RemittanceNFT::record_default` or penalize score down toward the minimum bound.

4. **Active Loan Collateral & Transfer Locks**:
   - While a loan is approved and active in `LoanManager`, `RemittanceNFT::transfer` remains locked and collateral remains held.

---

## 6. Fuzzing Strategy

1. **Property-Based Testing**: Use random valid and boundary inputs to verify algebraic invariants (`TotalOutstanding <= TotalManagedAssets`, score bounds `[300, 850]`, share price monotonicity).
2. **State Machine Invariant Testing**: Generate pseudo-random sequences of deposits, borrows, repayments, yield events, and defaults to verify state machine preservation.
3. **Boundary Condition Testing**: Target edge-case timestamps, ledger sequences, zero amounts, maximum integer values, and threshold boundaries.
4. **Error Handling Integrity**: Validate that invalid states and unauthorized calls consistently produce typed Soroban contract errors rather than unhandled panic or memory violations.
