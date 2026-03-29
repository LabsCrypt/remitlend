use soroban_sdk::{testutils::Address as _, Address, Env};
use super::*;

#[test]
fn test_pause_unpause() {
    let env = Env::default();
    let admin = Address::generate(&env);
    LoanManager::initialize(env.clone(), admin.clone());
    assert!(!LoanManager::is_paused(env.clone()));
    LoanManager::pause(env.clone(), admin.clone());
    assert!(LoanManager::is_paused(env.clone()));
    LoanManager::unpause(env.clone(), admin.clone());
    assert!(!LoanManager::is_paused(env));
}

#[test]
#[should_panic(expected = "not authorized")]
fn test_pause_non_admin_fails() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let not_admin = Address::generate(&env);
    LoanManager::initialize(env.clone(), admin.clone());
    LoanManager::pause(env, not_admin);
}

#[test]
#[should_panic(expected = "contract is paused")]
fn test_mutating_blocked_when_paused() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    LoanManager::initialize(env.clone(), admin.clone());
    LoanManager::pause(env.clone(), admin);
    LoanManager::request_loan(env, user, 100);
}
