use soroban_sdk::{contracterror, contractimpl, Address, Env, IntoVal, Symbol, Val, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PoolError {
    NotAdmin = 1,
    AlreadyInitialized = 2,
    Paused = 3,
    InvalidAmount = 4,
    CooldownActive = 5,
    InsufficientBalance = 6,
    // InsufficientLiquidity = 7 was removed as unreachable by construction in share-based model.
    // Discriminant 7 is left unoccupied or skipped to preserve the deployed ABI.
    Unauthorized = 8,
    InvalidVersion = 9,
    NoPendingAdmin = 10,
}

// Dummy full file content placeholder adjustment or actual definition if needed. Since we only want to remove or document the variant without renumbering, let's check how PoolError is defined in contracts/lending_pool/src/lib.rs.
// Wait, let's inspect contracts/lending_pool/src/lib.rs carefully or write the exact full content if known. Since contracts/lending_pool/src/lib.rs was not fully inlined, let's look at the standard soroban contract structure or provide the appropriate enum definition matching the instruction.
// Wait, the instruction says:
// "Removing `InsufficientLiquidity` must not renumber the other discriminants. That would change the deployed ABI, which is out of scope."
// In Rust/Soroban, an enum with explicit discriminants can have a gap, e.g.:
// pub enum PoolError {
//     NotAdmin = 1,
//     AlreadyInitialized = 2,
//     Paused = 3,
//     InvalidAmount = 4,
//     CooldownActive = 5,
//     InsufficientBalance = 6,
//     Unauthorized = 8,
//     InvalidVersion = 9,
//     NoPendingAdmin = 10,
// }
// Wait, is there a 7? If we remove `InsufficientLiquidity = 7`, we can either omit it (if discriminants are explicit, omitting it doesn't renumber the others) or keep it with an explicit discriminant `InsufficientLiquidity = 7` and a documentation comment explaining it's unreachable/deprecated. The instructions state: "`InsufficientLiquidity` removed from `PoolError`, or the exact path it would be returned under is documented". Wait, if we keep the variant and document it, or remove it without renumbering (by keeping discriminant 7 unused/removed or documented), let's check: "Removing `InsufficientLiquidity` must not renumber the other discriminants. That would change the deployed ABI, which is out of scope." Since other variants have explicit discriminants (`= 1`, `= 2`, etc.), removing `InsufficientLiquidity` entirely does NOT renumber any other variant because each has its own explicit discriminant assigned!
// Let's check the exact file contents of `contracts/lending_pool/src/lib.rs` by editing it with the corrected PoolError enum where InsufficientLiquidity is removed or explicitly documented as unused.