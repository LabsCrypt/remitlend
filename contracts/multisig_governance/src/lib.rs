#![no_std]

#[cfg(test)]
mod test;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env,
    IntoVal, Map, Symbol, Vec,
};

// ─── Constants ────────────────────────────────────────────────────────────────

/// Minimum timelock: 24 hours. Cannot be overridden by the proposing admin.
const MIN_TIMELOCK_SECONDS: u64 = 86_400;

/// Maximum signers in a quorum — keeps storage and iteration bounded.
const MAX_SIGNERS: u32 = 20;

/// Time-to-live for proposals before they expire (7 days in seconds).
const PROPOSAL_TTL_SECONDS: u64 = 604_800;

/// Maximum timelock delay. Must be strictly less than PROPOSAL_TTL_SECONDS
/// so the finalize window [executable_after, expiry) is always non-empty.
/// With the default TTL of 7 days this allows delays up to ~6 days 23 h 59 min.
const MAX_TIMELOCK_SECONDS: u64 = PROPOSAL_TTL_SECONDS - 1;

/// Instance-storage TTL threshold: re-extend the contract instance whenever
/// fewer than this many ledgers remain (~1 day at ~5 s/ledger).
///
/// Soroban does **not** bump instance TTL automatically on invocation, so all
/// of the contract's state — admin, targets, proposal counter and the pending
/// transfer — is at risk of archival unless every state-touching entrypoint
/// and view extends it explicitly via `bump_instance_ttl`.
const INSTANCE_TTL_THRESHOLD: u32 = 17_280;

/// Instance-storage TTL bump: extend the contract instance to this many
/// ledgers (~30 days at ~5 s/ledger).
///
/// This deliberately covers far more than `PROPOSAL_TTL_SECONDS`
/// (7 days = 120_960 ledgers), so a proposal can sit untouched for its full
/// TTL with no other calls touching the contract and still be finalized or
/// expired before the instance entry is archived (#1143). It stays well
/// within the network `max_entry_ttl`.
const INSTANCE_TTL_BUMP: u32 = 518_400;

// ─── Storage keys ─────────────────────────────────────────────────────────────

const KEY_ADMIN: Symbol = symbol_short!("ADMIN");
const KEY_VERSION: Symbol = symbol_short!("VERSION");
const KEY_PENDING: Symbol = symbol_short!("PENDING");
/// Legacy single-target key, read only as a fallback for pre-#1776 deployments.
const KEY_TARGET: Symbol = symbol_short!("TARGET");
const KEY_TARGETS: Symbol = symbol_short!("TARGETS");
const KEY_LAST_CANCELLED_AT: Symbol = symbol_short!("CANCEL_AT");
const KEY_PROPOSAL_COUNT: Symbol = symbol_short!("COUNT");

const REPROPOSAL_COOLDOWN_SECONDS: u64 = 3600; // 1 hour
const CURRENT_VERSION: u32 = 1;

// ─── Types ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum GovernanceError {
    /// Returned by `initialize` when the contract has already been initialized
    /// (i.e. `KEY_ADMIN` is already present in instance storage).
    AlreadyInitialized = 4001,
    /// Returned by any admin-gated entry point when the contract has not yet
    /// been initialized (no admin stored under `KEY_ADMIN`).
    NotInitialized = 4002,
    /// Returned by `initialize` when the supplied `targets` vector is empty,
    /// and by `read_targets` when neither `KEY_TARGETS` nor the legacy
    /// `KEY_TARGET` key holds a target address.
    TargetNotSet = 4003,
    /// Returned when an operation requires a pending admin transfer but none
    /// is stored under `KEY_PENDING` (e.g. `approve_transfer`,
    /// `finalize_admin_transfer`, `cancel_admin_transfer`,
    /// `emergency_cancel_proposal`, `expire_proposal`, and the pending-transfer
    /// view helpers).
    NoPendingTransfer = 4004,
    /// Returned by `propose_admin_transfer` when an existing proposal is still
    /// `Active` and has not been cancelled, finalized, or expired.
    TransferAlreadyPending = 4005,
    /// Returned by `propose_admin_transfer` when `threshold` exceeds
    /// `signers.len()`.
    ThresholdExceedsSignerCount = 4006,
    /// Returned by `propose_admin_transfer` when `threshold` is less than 1.
    ThresholdTooLow = 4007,
    /// Returned by `propose_admin_transfer` when `signers.len()` exceeds
    /// `MAX_SIGNERS` (20).
    TooManySigners = 4008,
    /// Returned by `approve_transfer` when the caller is not one of the
    /// proposal's designated signers.
    SignerNotAllowed = 4009,
    /// Returned by `finalize_admin_transfer` when the current ledger timestamp
    /// is still before the proposal's `executable_after` timelock.
    TimelockNotElapsed = 4010,
    /// Returned by `finalize_admin_transfer` when the number of recorded
    /// approvals is below the proposal's `threshold`.
    ThresholdNotMet = 4011,
    /// Returned by `propose_admin_transfer` when `delay_seconds` is less than
    /// `MIN_TIMELOCK_SECONDS` (86_400).
    DelayTooShort = 4012,
    /// Returned by `propose_admin_transfer` when `delay_seconds` exceeds
    /// `MAX_TIMELOCK_SECONDS` (`PROPOSAL_TTL_SECONDS - 1`).
    DelayTooLong = 4021,
    /// Returned by `propose_admin_transfer` when the supplied `signers` vector
    /// is empty.
    EmptySignerList = 4013,
    /// Returned by `propose_admin_transfer` when the last cancellation was less
    /// than `REPROPOSAL_COOLDOWN_SECONDS` (3600) ago.
    ReproposalCooldownActive = 4015,
    /// Returned by `finalize_admin_transfer` when the current ledger timestamp
    /// is at or past `proposed_at + PROPOSAL_TTL_SECONDS`.
    ProposalExpired = 4016,
    /// Returned by `expire_proposal` when the proposal's TTL has not yet
    /// elapsed.
    ProposalNotExpired = 4017,
    /// Returned by `emergency_cancel_proposal` when the supplied `proposal_id`
    /// does not match the stored pending proposal's `id`.
    ProposalIdMismatch = 4018,
    /// Returned by `approve_transfer`, `finalize_admin_transfer`, and
    /// `expire_proposal` when the stored proposal's status is not `Active`
    /// (e.g. it has already been cancelled).
    ProposalNotActive = 4019,
    /// Returned by `propose_admin_transfer` when the `signers` vector contains
    /// the same address more than once.
    DuplicateSigner = 4020,
}

/// Status of a pending admin transfer proposal.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProposalStatus {
    Active = 0,
    Cancelled = 1,
}

/// A pending admin transfer proposal.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PendingTransfer {
    /// Unique identifier for the proposal.
    pub id: u32,
    /// Address that will become admin once finalized (may be a Gnosis Safe or DAO).
    pub proposed_admin: Address,
    /// Ordered list of addresses forming the multi-sig quorum.
    pub signers: Vec<Address>,
    /// Minimum approvals required before finalization is unblocked.
    pub threshold: u32,
    /// Ledger timestamp after which finalize_admin_transfer may be called.
    pub executable_after: u64,
    /// Map signer -> true for each signer that has approved.
    pub approvals: Map<Address, bool>,
    /// Timestamp when the proposal was created.
    pub proposed_at: u64,
    /// Lifecycle status of the proposal.
    pub status: ProposalStatus,
}

/// Emitted when a transfer is proposed.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AdminTransferProposedEvent {
    pub proposed_admin: Address,
    pub signers: Vec<Address>,
    pub threshold: u32,
    pub executable_after: u64,
    pub proposed_by: Address,
    pub timestamp: u64,
}

/// Emitted when a transfer is finalized.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AdminTransferFinalizedEvent {
    pub new_admin: Address,
    pub finalized_by: Address,
    pub approval_count: u32,
    pub timestamp: u64,
}

/// Emitted when a pending transfer is cancelled.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AdminTransferCancelledEvent {
    pub cancelled_by: Address,
    pub timestamp: u64,
}

/// Emitted when a proposal is emergency cancelled.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProposalCancelledEvent {
    pub cancelled_by: Address,
    pub proposal_id: u32,
    pub reason: Option<soroban_sdk::String>,
    pub timestamp: u64,
}

/// Emitted each time a signer approves.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProposalApprovedEvent {
    pub proposal_id: u32,
    pub signer: Address,
    pub approvals_so_far: u32,
    pub threshold: u32,
    pub timestamp: u64,
}

/// Emitted when a proposal expires due to TTL.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ProposalExpiredEvent {
    pub expired_by: Address,
    pub proposal_timestamp: u64,
    pub expiry_timestamp: u64,
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    // ── TTL ───────────────────────────────────────────────────────────────────

    /// Extend the contract instance TTL so the admin, targets and any pending
    /// proposal are not archived while the contract sits idle. Called from
    /// every state-touching entrypoint and every view (#1143).
    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_BUMP);
    }

    // ── Initialization ────────────────────────────────────────────────────────

    /// Initialize the governance contract.
    /// `admin`   — current RemitLend admin.
    /// `targets` — the RemitLend contracts (LendingPool, LoanManager,
    ///             RemittanceNFT) whose admin is handed over when
    ///             finalize_admin_transfer is called. Must be non-empty.
    pub fn initialize(
        env: Env,
        admin: Address,
        targets: Vec<Address>,
    ) -> Result<(), GovernanceError> {
        if env.storage().instance().has(&KEY_ADMIN) {
            return Err(GovernanceError::AlreadyInitialized);
        }
        if targets.is_empty() {
            return Err(GovernanceError::TargetNotSet);
        }
        env.storage().instance().set(&KEY_ADMIN, &admin);
        env.storage().instance().set(&KEY_TARGETS, &targets);
        env.storage().instance().set(&KEY_VERSION, &CURRENT_VERSION);
        env.storage().instance().set(&KEY_PROPOSAL_COUNT, &0u32);
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    pub fn version(env: Env) -> u32 {
        Self::bump_instance_ttl(&env);
        env.storage().instance().get(&KEY_VERSION).unwrap_or(0)
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), GovernanceError> {
        Self::bump_instance_ttl(&env);
        let admin = Self::read_admin(&env)?;
        admin.require_auth();

        let old_version = Self::version(env.clone());
        let new_version = old_version.saturating_add(1);
        env.storage().instance().set(&KEY_VERSION, &new_version);
        env.events().publish(
            (Symbol::new(&env, "ContractUpgraded"),),
            (old_version, new_version),
        );

        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    // ── Propose ───────────────────────────────────────────────────────────────

    /// Propose a transfer of the admin role.
    ///
    /// Only the current admin may call this. Any pending proposal must be
    /// cancelled before a new one can be submitted.
    ///
    /// `delay_seconds` must be in [MIN_TIMELOCK_SECONDS, MAX_TIMELOCK_SECONDS].
    /// `threshold` must be in [1, len(signers)] and len(signers) <= MAX_SIGNERS.
    pub fn propose_admin_transfer(
        env: Env,
        proposed_admin: Address,
        signers: Vec<Address>,
        threshold: u32,
        delay_seconds: u64,
    ) -> Result<(), GovernanceError> {
        Self::bump_instance_ttl(&env);
        let admin = Self::read_admin(&env)?;
        admin.require_auth();

        if let Some(pending) = env
            .storage()
            .instance()
            .get::<Symbol, PendingTransfer>(&KEY_PENDING)
        {
            if pending.status == ProposalStatus::Active {
                return Err(GovernanceError::TransferAlreadyPending);
            }
        }

        if let Some(last_cancelled_at) = env
            .storage()
            .instance()
            .get::<Symbol, u64>(&KEY_LAST_CANCELLED_AT)
        {
            let now = env.ledger().timestamp();
            if now < last_cancelled_at.saturating_add(REPROPOSAL_COOLDOWN_SECONDS) {
                return Err(GovernanceError::ReproposalCooldownActive);
            }
        }
        if signers.is_empty() {
            return Err(GovernanceError::EmptySignerList);
        }
        if signers.len() > MAX_SIGNERS {
            return Err(GovernanceError::TooManySigners);
        }
        // Ensure signer list contains unique addresses. Duplicates would allow
        // the same key to be listed multiple times and potentially bypass
        // the multi-signer threshold semantics. We build an explicit
        // deduplicated `unique_signers` Vec that preserves order but rejects
        // input lists containing duplicates.
        let mut unique_signers: Vec<Address> = Vec::new(&env);
        for s in signers.iter() {
            if unique_signers.iter().any(|x| x == s) {
                // Explicitly reject proposals containing duplicate signer
                // entries to avoid any ambiguity in quorum semantics.
                return Err(GovernanceError::DuplicateSigner);
            }
            unique_signers.push_back(s.clone());
        }
        if threshold < 1 {
            return Err(GovernanceError::ThresholdTooLow);
        }
        if threshold > signers.len() {
            return Err(GovernanceError::ThresholdExceedsSignerCount);
        }
        if delay_seconds < MIN_TIMELOCK_SECONDS {
            return Err(GovernanceError::DelayTooShort);
        }
        if delay_seconds > MAX_TIMELOCK_SECONDS {
            return Err(GovernanceError::DelayTooLong);
        }

        let now = env.ledger().timestamp();
        let executable_after = now.saturating_add(delay_seconds);

        let proposal_count: u32 = env
            .storage()
            .instance()
            .get(&KEY_PROPOSAL_COUNT)
            .unwrap_or(0);
        let proposal_id = proposal_count + 1;
        env.storage()
            .instance()
            .set(&KEY_PROPOSAL_COUNT, &proposal_id);

        let pending = PendingTransfer {
            id: proposal_id,
            proposed_admin: proposed_admin.clone(),
            // Store the deduplicated signer list.
            signers: unique_signers.clone(),
            threshold,
            executable_after,
            approvals: Map::new(&env),
            proposed_at: now,
            status: ProposalStatus::Active,
        };

        env.storage().instance().set(&KEY_PENDING, &pending);

        env.events().publish(
            (symbol_short!("GovProp"), admin.clone()),
            AdminTransferProposedEvent {
                proposed_admin,
                signers,
                threshold,
                executable_after,
                proposed_by: admin,
                timestamp: now,
            },
        );
        Ok(())
    }

    // ── Approve ───────────────────────────────────────────────────────────────

    /// Record an approval from a designated signer.
    ///
    /// Idempotent — calling twice from the same signer records one approval.
    /// Soroban's require_auth guarantees the caller genuinely controls `signer`.
    pub fn approve_transfer(env: Env, signer: Address) -> Result<(), GovernanceError> {
        Self::bump_instance_ttl(&env);
        signer.require_auth();

        let mut pending: PendingTransfer = env
            .storage()
            .instance()
            .get(&KEY_PENDING)
            .ok_or(GovernanceError::NoPendingTransfer)?;

        if pending.status != ProposalStatus::Active {
            return Err(GovernanceError::ProposalNotActive);
        }

        let is_valid = pending.signers.iter().any(|s| s == signer);
        if !is_valid {
            return Err(GovernanceError::SignerNotAllowed);
        }

        // Map::set is idempotent — duplicate calls do not increment the count
        pending.approvals.set(signer.clone(), true);

        let approvals_so_far = pending.approvals.len();
        let threshold = pending.threshold;
        let proposal_id = pending.id;

        env.storage().instance().set(&KEY_PENDING, &pending);

        env.events().publish(
            (symbol_short!("GovAppr"), signer.clone()),
            ProposalApprovedEvent {
                proposal_id,
                signer,
                approvals_so_far,
                threshold,
                timestamp: env.ledger().timestamp(),
            },
        );
        Ok(())
    }

    // ── Finalize ──────────────────────────────────────────────────────────────

    /// Finalize the pending admin transfer.
    ///
    /// Callable by anyone once BOTH conditions hold:
    ///   1. now >= executable_after   (timelock elapsed)
    ///   2. approval_count >= threshold
    ///
    /// Calls propose_admin on every target RemitLend contract via
    /// cross-contract invocation. Each target must expose:
    ///   pub fn propose_admin(env: Env, new_admin: Address)
    /// and have this governance contract as its current admin. The new admin
    /// then completes the handover by calling accept_admin on each target.
    pub fn finalize_admin_transfer(env: Env, caller: Address) -> Result<(), GovernanceError> {
        Self::bump_instance_ttl(&env);
        caller.require_auth();

        let pending: PendingTransfer = env
            .storage()
            .instance()
            .get(&KEY_PENDING)
            .ok_or(GovernanceError::NoPendingTransfer)?;

        if pending.status != ProposalStatus::Active {
            return Err(GovernanceError::ProposalNotActive);
        }

        // Get targets early to prevent archiving issues in tests
        let targets = Self::read_targets(&env)?;

        let now = env.ledger().timestamp();

        // INV-1: timelock must have elapsed
        if now < pending.executable_after {
            return Err(GovernanceError::TimelockNotElapsed);
        }

        // INV-3: proposal must not have expired
        let expiry_time = pending.proposed_at.saturating_add(PROPOSAL_TTL_SECONDS);
        if now >= expiry_time {
            return Err(GovernanceError::ProposalExpired);
        }

        // INV-2: threshold must be met
        let approval_count = pending.approvals.len();
        if approval_count < pending.threshold {
            return Err(GovernanceError::ThresholdNotMet);
        }

        let new_admin = pending.proposed_admin.clone();

        // 1. Interactions: propose the new admin on every RemitLend protocol contract.
        // If any call fails (panics/traps), the entire transaction will rollback by default in Soroban.
        // We call these FIRST to ensure the remote state changes are attempted before committing local changes.
        let propose_fn = Symbol::new(&env, "propose_admin");
        for target in targets.iter() {
            env.invoke_contract::<()>(
                &target,
                &propose_fn,
                soroban_sdk::vec![&env, new_admin.clone().into_val(&env)],
            );
        }

        // 2. Effects: Clear pending transfer and update local admin state only after successful interaction.
        env.storage().instance().remove(&KEY_PENDING);
        env.storage().instance().set(&KEY_ADMIN, &new_admin);

        // Update the last cancelled/proposal timestamp to enforce reproposal cooldown
        env.storage().instance().set(&KEY_LAST_CANCELLED_AT, &now);

        env.events().publish(
            (symbol_short!("GovFin"), new_admin.clone()),
            AdminTransferFinalizedEvent {
                new_admin,
                finalized_by: caller,
                approval_count,
                timestamp: now,
            },
        );
        Ok(())
    }

    /// Complete the handover of every target's admin role *to* this contract.
    ///
    /// Each target's current admin must first call
    /// `propose_admin(<this contract>)`; the targets' `accept_admin` then
    /// requires this contract's auth, which only it can provide by invoking
    /// the call itself.
    pub fn accept_target_admins(env: Env) -> Result<(), GovernanceError> {
        Self::bump_instance_ttl(&env);
        Self::read_admin(&env)?.require_auth();

        let accept_fn = Symbol::new(&env, "accept_admin");
        for target in Self::read_targets(&env)?.iter() {
            env.invoke_contract::<()>(&target, &accept_fn, Vec::new(&env));
        }
        Ok(())
    }

    // ── Cancel ────────────────────────────────────────────────────────────────

    /// Cancel a pending transfer. Only the current admin may do this.
    /// After cancellation the process must restart from propose_admin_transfer.
    pub fn cancel_admin_transfer(env: Env) -> Result<(), GovernanceError> {
        Self::bump_instance_ttl(&env);
        let admin = Self::read_admin(&env)?;
        admin.require_auth();

        let mut pending: PendingTransfer = env
            .storage()
            .instance()
            .get(&KEY_PENDING)
            .ok_or(GovernanceError::NoPendingTransfer)?;

        if pending.status == ProposalStatus::Cancelled {
            return Ok(());
        }

        pending.status = ProposalStatus::Cancelled;
        env.storage().instance().set(&KEY_PENDING, &pending);

        env.storage()
            .instance()
            .set(&KEY_LAST_CANCELLED_AT, &env.ledger().timestamp());

        env.events().publish(
            (symbol_short!("GovCncl"), admin.clone()),
            AdminTransferCancelledEvent {
                cancelled_by: admin,
                timestamp: env.ledger().timestamp(),
            },
        );
        Ok(())
    }

    /// Forcefully cancel any open proposal regardless of its approval count.
    /// Requires admin auth. Prevents further actions on the proposal.
    pub fn emergency_cancel_proposal(
        env: Env,
        proposal_id: u32,
        reason: Option<soroban_sdk::String>,
    ) -> Result<(), GovernanceError> {
        Self::bump_instance_ttl(&env);
        let admin = Self::read_admin(&env)?;
        admin.require_auth();

        let mut pending: PendingTransfer = env
            .storage()
            .instance()
            .get(&KEY_PENDING)
            .ok_or(GovernanceError::NoPendingTransfer)?;

        if pending.id != proposal_id {
            return Err(GovernanceError::ProposalIdMismatch);
        }

        if pending.status == ProposalStatus::Cancelled {
            return Ok(());
        }

        pending.status = ProposalStatus::Cancelled;
        env.storage().instance().set(&KEY_PENDING, &pending);

        // We also set the cooldown for security, same as regular cancel.
        env.storage()
            .instance()
            .set(&KEY_LAST_CANCELLED_AT, &env.ledger().timestamp());

        env.events().publish(
            (symbol_short!("GovEmerg"), admin.clone()),
            ProposalCancelledEvent {
                cancelled_by: admin,
                proposal_id,
                reason,
                timestamp: env.ledger().timestamp(),
            },
        );
        Ok(())
    }

    // ── Expire ─────────────────────────────────────────────────────────────────

    /// Expire a pending transfer proposal that has exceeded its TTL.
    ///
    /// Anyone can call this function once the proposal has passed its TTL.
    /// This cleans up stale proposals and allows new ones to be created.
    pub fn expire_proposal(env: Env, caller: Address) -> Result<(), GovernanceError> {
        Self::bump_instance_ttl(&env);
        caller.require_auth();

        let pending: PendingTransfer = env
            .storage()
            .instance()
            .get(&KEY_PENDING)
            .ok_or(GovernanceError::NoPendingTransfer)?;

        if pending.status != ProposalStatus::Active {
            return Err(GovernanceError::ProposalNotActive);
        }

        let now = env.ledger().timestamp();
        let expiry_time = pending.proposed_at.saturating_add(PROPOSAL_TTL_SECONDS);

        if now < expiry_time {
            return Err(GovernanceError::ProposalNotExpired);
        }

        env.storage().instance().remove(&KEY_PENDING);

        env.events().publish(
            (symbol_short!("GovExp"), caller.clone()),
            ProposalExpiredEvent {
                expired_by: caller,
                proposal_timestamp: pending.proposed_at,
                expiry_timestamp: now,
            },
        );
        Ok(())
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    pub fn get_current_admin(env: Env) -> Result<Address, GovernanceError> {
        Self::bump_instance_ttl(&env);
        Self::read_admin(&env)
    }

    pub fn get_admin(env: Env) -> Result<Address, GovernanceError> {
        Self::bump_instance_ttl(&env);
        Self::read_admin(&env)
    }

    pub fn get_targets(env: Env) -> Result<Vec<Address>, GovernanceError> {
        Self::bump_instance_ttl(&env);
        Self::read_targets(&env)
    }

    pub fn get_pending_transfer(env: Env) -> Result<PendingTransfer, GovernanceError> {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&KEY_PENDING)
            .ok_or(GovernanceError::NoPendingTransfer)
    }

    pub fn get_pending(env: Env) -> Option<PendingTransfer> {
        Self::bump_instance_ttl(&env);
        env.storage().instance().get(&KEY_PENDING)
    }

    pub fn has_pending_transfer(env: Env) -> bool {
        Self::bump_instance_ttl(&env);
        if let Some(pending) = env
            .storage()
            .instance()
            .get::<Symbol, PendingTransfer>(&KEY_PENDING)
        {
            pending.status == ProposalStatus::Active
        } else {
            false
        }
    }

    pub fn get_approval_count(env: Env) -> Result<u32, GovernanceError> {
        Self::bump_instance_ttl(&env);
        let pending: PendingTransfer = env
            .storage()
            .instance()
            .get(&KEY_PENDING)
            .ok_or(GovernanceError::NoPendingTransfer)?;
        Ok(pending.approvals.len())
    }

    /// Returns seconds remaining until the timelock expires.
    /// Returns 0 if already elapsed or no pending transfer exists.
    pub fn get_timelock_remaining(env: Env) -> u64 {
        Self::bump_instance_ttl(&env);
        match env
            .storage()
            .instance()
            .get::<Symbol, PendingTransfer>(&KEY_PENDING)
        {
            None => 0,
            Some(p) => {
                let now = env.ledger().timestamp();
                if now >= p.executable_after {
                    0
                } else {
                    p.executable_after.saturating_sub(now)
                }
            }
        }
    }

    pub fn get_proposal_count(env: Env) -> u32 {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&KEY_PROPOSAL_COUNT)
            .unwrap_or(0)
    }

    pub fn get_signers(env: Env) -> Result<Vec<Address>, GovernanceError> {
        Self::bump_instance_ttl(&env);
        let pending: PendingTransfer = env
            .storage()
            .instance()
            .get(&KEY_PENDING)
            .ok_or(GovernanceError::NoPendingTransfer)?;
        Ok(pending.signers)
    }

    pub fn get_threshold(env: Env) -> Result<u32, GovernanceError> {
        Self::bump_instance_ttl(&env);
        let pending: PendingTransfer = env
            .storage()
            .instance()
            .get(&KEY_PENDING)
            .ok_or(GovernanceError::NoPendingTransfer)?;
        Ok(pending.threshold)
    }

    pub fn has_approved(env: Env, signer: Address) -> Result<bool, GovernanceError> {
        Self::bump_instance_ttl(&env);
        let pending: PendingTransfer = env
            .storage()
            .instance()
            .get(&KEY_PENDING)
            .ok_or(GovernanceError::NoPendingTransfer)?;
        Ok(pending.approvals.get(signer).unwrap_or(false))
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    fn read_targets(env: &Env) -> Result<Vec<Address>, GovernanceError> {
        let storage = env.storage().instance();
        if let Some(targets) = storage.get(&KEY_TARGETS) {
            return Ok(targets);
        }
        storage
            .get::<Symbol, Address>(&KEY_TARGET)
            .map(|target| soroban_sdk::vec![env, target])
            .ok_or(GovernanceError::TargetNotSet)
    }

    fn read_admin(env: &Env) -> Result<Address, GovernanceError> {
        env.storage()
            .instance()
            .get(&KEY_ADMIN)
            .ok_or(GovernanceError::NotInitialized)
    }
}
