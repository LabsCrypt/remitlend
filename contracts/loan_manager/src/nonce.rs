use soroban_sdk::{contracterror, contracttype, Address, Env};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OpKind {
    ProcessDefaults,
    ApproveLoans,
    GovernanceExecute,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OpNonceKey {
    pub address: Address,
    pub op_kind: OpKind,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum BatchError {
    NonceReused = 1,
    BatchWindowExpired = 2,
}

pub fn consume_nonce(env: &Env, address: Address, op_kind: OpKind, supplied_nonce: u64) -> Result<(), BatchError> {
    let key = OpNonceKey { address, op_kind };
    let current_nonce: u64 = env.storage().persistent().get(&key).unwrap_or(0);
    
    if supplied_nonce != current_nonce + 1 {
        return Err(BatchError::NonceReused);
    }
    
    env.storage().persistent().set(&key, &supplied_nonce);
    
    // Bump TTL for the entry
    env.storage().persistent().extend_ttl(&key, 1000, 100000);
    
    Ok(())
}

pub fn validate_batch_window(env: &Env, valid_until_ledger: u32) -> Result<(), BatchError> {
    if env.ledger().sequence() > valid_until_ledger {
        return Err(BatchError::BatchWindowExpired);
    }
    Ok(())
}
