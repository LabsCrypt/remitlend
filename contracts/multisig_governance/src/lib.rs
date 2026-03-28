#![no_std]

#[cfg(test)]
mod test;
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, IntoVal, Map, Symbol,
    Vec,
};

// ─── Constants ────────────────────────────────────────────────────────────────

/// Minimum timelock: 24 hours. Cannot be overridden by the proposing admin.
const MIN_TIMELOCK_SECONDS: u64 = 86_400;

/// Maximum signers in a quorum — keeps storage and iteration bounded.
const MAX_SIGNERS: u32 = 20;

// ─── Storage keys ─────────────────────────────────────────────────────────────

const KEY_ADMIN: Symbol = symbol_short!("ADMIN");
const KEY_VERSION: Symbol = symbol_short!("VERSION");
const KEY_PENDING: Symbol = symbol_short!("PENDING");
const KEY_TARGET: Symbol = symbol_short!("TARGET");
const KEY_LAST_CANCELLED_AT: Symbol = symbol_short!("CANCEL_AT");

const REPROPOSAL_COOLDOWN_SECONDS: u64 = 3600; // 1 hour
const CURRENT_VERSION: u32 = 1;

// ─── Types ────────────────────────────────────────────────────────────────────

/// A pending admin transfer proposal.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PendingTransfer {
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

/// Emitted each time a signer approves.
#[contracttype]
#[derive(Clone, Debug)]
pub struct TransferApprovedEvent {
    pub signer: Address,
    pub approvals_so_far: u32,
    pub threshold: u32,
    pub timestamp: u64,
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    // ── Initialization ────────────────────────────────────────────────────────

    /// Initialize the governance contract.
    /// `admin`           — current RemitLend admin.
    /// `target_contract` — the RemitLend contract whose admin will be updated
    ///                     when finalize_admin_transfer is called.
    pub fn initialize(env: Env, admin: Address, target_contract: Address) {
        if env.storage().instance().has(&KEY_ADMIN) {
            panic!("already initialized");
        }
        env.storage().instance().set(&KEY_ADMIN, &admin);
        env.storage().instance().set(&KEY_TARGET, &target_contract);
        env.storage().instance().set(&KEY_VERSION, &CURRENT_VERSION);
    }

    pub fn version(env: Env) -> u32 {
        env.storage().instance().get(&KEY_VERSION).unwrap_or(0)
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin = Self::get_admin(&env);
        admin.require_auth();

        let old_version = Self::version(env.clone());
        let new_version = old_version.saturating_add(1);
        env.storage().instance().set(&KEY_VERSION, &new_version);
        env.events().publish(
            (Symbol::new(&env, "ContractUpgraded"),),
            (old_version, new_version),
        );

        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    // ── Propose ───────────────────────────────────────────────────────────────

    /// Propose a transfer of the admin role.
    ///
    /// Only the current admin may call this. Any pending proposal must be
    /// cancelled before a new one can be submitted.
    ///
    /// `delay_seconds` must be >= MIN_TIMELOCK_SECONDS (86400 = 24 h).
    /// `threshold` must be in [1, len(signers)] and len(signers) <= MAX_SIGNERS.
    pub fn propose_admin_transfer(
        env: Env,
        proposed_admin: Address,
        signers: Vec<Address>,
        threshold: u32,
        delay_seconds: u64,
    ) {
        let admin = Self::get_admin(&env);
        admin.require_auth();

        if env.storage().instance().has(&KEY_PENDING) {
            panic!("transfer already pending — cancel first (4005)");
        }

        if let Some(last_cancelled_at) = env
            .storage()
            .instance()
            .get::<Symbol, u64>(&KEY_LAST_CANCELLED_AT)
        {
            let now = env.ledger().timestamp();
            if now < last_cancelled_at.saturating_add(REPROPOSAL_COOLDOWN_SECONDS) {
                panic!(
                    "must wait at least {} seconds after cancellation before re-proposing (4015)",
                    REPROPOSAL_COOLDOWN_SECONDS
                );
            }
        }
        if signers.is_empty() {
            panic!("signer list must not be empty (4013)");
        }
        if signers.len() > MAX_SIGNERS {
            panic!("signer list exceeds MAX_SIGNERS of 20 (4008)");
        }
        if threshold < 1 {
            panic!("threshold must be >= 1 (4007)");
        }
        if threshold > signers.len() {
            panic!("threshold exceeds signer count (4006)");
        }
        if delay_seconds < MIN_TIMELOCK_SECONDS {
            panic!("delay must be >= 86400 seconds (24 hours) (4012)");
        }

        let now = env.ledger().timestamp();
        let executable_after = now.saturating_add(delay_seconds);

        let pending = PendingTransfer {
            proposed_admin: proposed_admin.clone(),
            signers: signers.clone(),
            threshold,
            executable_after,
            approvals: Map::new(&env),
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
    }

    // ── Approve ───────────────────────────────────────────────────────────────

    /// Record an approval from a designated signer.
    ///
    /// Idempotent — calling twice from the same signer records one approval.
    /// Soroban's require_auth guarantees the caller genuinely controls `signer`.
    pub fn approve_transfer(env: Env, signer: Address) {
        signer.require_auth();

        let mut pending: PendingTransfer = env
            .storage()
            .instance()
            .get(&KEY_PENDING)
            .expect("no pending transfer (4004)");

        let is_valid = pending.signers.iter().any(|s| s == signer);
        if !is_valid {
            panic!("caller is not in the signer list (4009)");
        }

        // Map::set is idempotent — duplicate calls do not increment the count
        pending.approvals.set(signer.clone(), true);

        let approvals_so_far = pending.approvals.len();
        let threshold = pending.threshold;

        env.storage().instance().set(&KEY_PENDING, &pending);

        env.events().publish(
            (symbol_short!("GovAppr"), signer.clone()),
            TransferApprovedEvent {
                signer,
                approvals_so_far,
                threshold,
                timestamp: env.ledger().timestamp(),
            },
        );
    }

    // ── Finalize ──────────────────────────────────────────────────────────────

    /// Finalize the pending admin transfer.
    ///
    /// Callable by anyone once BOTH conditions hold:
    ///   1. now >= executable_after   (timelock elapsed)
    ///   2. approval_count >= threshold
    ///
    /// Calls set_admin on the target RemitLend contract via cross-contract
    /// invocation. The target must expose:
    ///   pub fn set_admin(env: Env, new_admin: Address)
    /// and must verify the caller is this governance contract address.
    pub fn finalize_admin_transfer(env: Env, caller: Address) {
        caller.require_auth();

        let pending: PendingTransfer = env
            .storage()
            .instance()
            .get(&KEY_PENDING)
            .expect("no pending transfer (4004)");

        // Get target early to prevent archiving issues in tests
        let target: Address = env
            .storage()
            .instance()
            .get(&KEY_TARGET)
            .expect("target contract not set");

        let now = env.ledger().timestamp();

        // INV-1: timelock must have elapsed
        if now < pending.executable_after {
            panic!("timelock not elapsed — wait until executable_after (4010)");
        }

        // INV-2: threshold must be met
        let approval_count = pending.approvals.len();
        if approval_count < pending.threshold {
            panic!("threshold not met — more approvals required (4011)");
        }

        let new_admin = pending.proposed_admin.clone();

        // 1. Interactions: Cross-contract call to update global admin in the RemitLend protocol contract.
        // If this call fails (panics/traps), the entire transaction will rollback by default in Soroban.
        // We call this FIRST to ensure the remote state change is attempted before committing local changes.
        env.invoke_contract::<()>(
            &target,
            &symbol_short!("set_admin"),
            soroban_sdk::vec![&env, new_admin.clone().into_val(&env)],
        );

        // 2. Effects: Clear pending transfer and update local admin state only after successful interaction.
        env.storage().instance().remove(&KEY_PENDING);
        env.storage().instance().set(&KEY_ADMIN, &new_admin);

        env.events().publish(
            (symbol_short!("GovFin"), new_admin.clone()),
            AdminTransferFinalizedEvent {
                new_admin,
                finalized_by: caller,
                approval_count,
                timestamp: now,
            },
        );
    }

    // ── Cancel ────────────────────────────────────────────────────────────────

    /// Cancel a pending transfer. Only the current admin may do this.
    /// After cancellation the process must restart from propose_admin_transfer.
    pub fn cancel_admin_transfer(env: Env) {
        let admin = Self::get_admin(&env);
        admin.require_auth();

        if !env.storage().instance().has(&KEY_PENDING) {
            panic!("no pending transfer to cancel (4004)");
        }

        env.storage().instance().remove(&KEY_PENDING);
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
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    pub fn get_current_admin(env: Env) -> Address {
        Self::get_admin(&env)
    }

    pub fn get_pending_transfer(env: Env) -> PendingTransfer {
        env.storage()
            .instance()
            .get(&KEY_PENDING)
            .expect("no pending transfer (4004)")
    }

    pub fn has_pending_transfer(env: Env) -> bool {
        env.storage().instance().has(&KEY_PENDING)
    }

    pub fn get_approval_count(env: Env) -> u32 {
        let pending: PendingTransfer = env
            .storage()
            .instance()
            .get(&KEY_PENDING)
            .expect("no pending transfer (4004)");
        pending.approvals.len()
    }

    /// Returns seconds remaining until the timelock expires.
    /// Returns 0 if already elapsed or no pending transfer exists.
    pub fn get_timelock_remaining(env: Env) -> u64 {
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

    // ── Private helpers ───────────────────────────────────────────────────────

    fn get_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&KEY_ADMIN)
            .expect("contract not initialized (4002)")
    }
}
