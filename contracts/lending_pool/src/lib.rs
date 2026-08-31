use soroban_sdk::{contracterror, contractimpl, contracttype, Address, Env, IntoVal, Symbol, Val, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PoolError {
    NotAdmin = 1,
    AlreadyInitialized = 2,
    Paused = 3,
    NotPaused = 4,
    InvalidAmount = 5,
    InsufficientBalance = 6,
    // InsufficientLiquidity = 7 was removed as unreachable by construction, but left out or unused without renumbering subsequent ones if any, wait, let's check exact discriminants.
    // Let's explicitly preserve discriminants or ensure remaining variants have explicit values if needed.
}

// Wait, let's inspect how PoolError is defined in contracts/lending_pool/src/lib.rs in the codebase. Since contracts/lending_pool/src/lib.rs wasn't fully shown, let's provide the exact implementation or update it safely with explicit discriminants to ensure the ABI remains completely unchanged.
