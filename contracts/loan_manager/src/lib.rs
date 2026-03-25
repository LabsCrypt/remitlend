#![no_std]
use soroban_sdk::{
    contract, contractclient, contractimpl, contracttype, symbol_short, Address, Env,
};

#[contractclient(name = "NftClient")]
pub trait RemittanceNftInterface {
    fn get_score(env: Env, user: Address) -> u32;
    fn update_score(env: Env, user: Address, repayment_amount: i128, minter: Option<Address>);
}

mod events;

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum LoanStatus {
    Pending,
    Approved,
    Repaid,
    Defaulted,
}

#[contracttype]
#[derive(Clone)]
pub struct Loan {
    pub borrower: Address,
    pub amount: i128,
    pub status: LoanStatus,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    NftContract,
    LendingPool,
    Token,
    Admin,
    Loan(u32),
    LoanCounter,
    MinScore,
    Paused,
}

#[contract]
pub struct LoanManager;

#[contractimpl]
impl LoanManager {
    const INSTANCE_TTL_THRESHOLD: u32 = 17280;
    const INSTANCE_TTL_BUMP: u32 = 518400;
    const PERSISTENT_TTL_THRESHOLD: u32 = 17280;
    const PERSISTENT_TTL_BUMP: u32 = 518400;

    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(Self::INSTANCE_TTL_THRESHOLD, Self::INSTANCE_TTL_BUMP);
    }

    fn bump_persistent_ttl(env: &Env, key: &DataKey) {
        env.storage().persistent().extend_ttl(
            key,
            Self::PERSISTENT_TTL_THRESHOLD,
            Self::PERSISTENT_TTL_BUMP,
        );
    }

    fn nft_contract(env: &Env) -> Address {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::NftContract)
            .expect("not initialized")
    }

    fn assert_not_paused(env: &Env) {
        Self::bump_instance_ttl(env);
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            panic!("contract is paused");
        }
    }

    pub fn initialize(
        env: Env,
        nft_contract: Address,
        lending_pool: Address,
        token: Address,
        admin: Address,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage()
            .instance()
            .set(&DataKey::NftContract, &nft_contract);
        env.storage()
            .instance()
            .set(&DataKey::LendingPool, &lending_pool);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::LoanCounter, &0u32);
        env.storage().instance().set(&DataKey::Paused, &false);
        Self::bump_instance_ttl(&env);
    }

    pub fn request_loan(env: Env, borrower: Address, amount: i128) -> u32 {
        borrower.require_auth();
        Self::assert_not_paused(&env);

        if amount <= 0 {
            panic!("loan amount must be positive");
        }

        let nft_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::NftContract)
            .expect("not initialized");
        let nft_client = NftClient::new(&env, &nft_contract);

        let score = nft_client.get_score(&borrower);
        let min_score: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinScore)
            .unwrap_or(500);
        if score < min_score {
            panic!("score too low for loan");
        }

        // Create loan record
        let mut loan_counter: u32 = env
            .storage()
            .instance()
            .get(&DataKey::LoanCounter)
            .unwrap_or(0);
        loan_counter += 1;

        let loan = Loan {
            borrower: borrower.clone(),
            amount,
            status: LoanStatus::Pending,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Loan(loan_counter), &loan);
        env.storage()
            .instance()
            .set(&DataKey::LoanCounter, &loan_counter);
        Self::bump_instance_ttl(&env);
        Self::bump_persistent_ttl(&env, &DataKey::Loan(loan_counter));

        events::loan_requested(&env, borrower.clone(), amount);
        env.events()
            .publish((symbol_short!("LoanReq"), borrower), loan_counter);

        loan_counter
    }

    pub fn approve_loan(env: Env, loan_id: u32) {
        use soroban_sdk::token::TokenClient;

        // Access control: only admin can approve loans
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
        Self::assert_not_paused(&env);

        // Get loan record
        let loan_key = DataKey::Loan(loan_id);
        let mut loan: Loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .expect("loan not found");
        Self::bump_persistent_ttl(&env, &loan_key);

        // Check loan status
        if loan.status != LoanStatus::Pending {
            panic!("loan is not pending");
        }

        // Update loan status to Approved
        loan.status = LoanStatus::Approved;
        env.storage().persistent().set(&loan_key, &loan);
        Self::bump_persistent_ttl(&env, &loan_key);

        // Transfer funds from LendingPool to borrower
        let lending_pool: Address = env
            .storage()
            .instance()
            .get(&DataKey::LendingPool)
            .expect("lending pool not set");
        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("token not set");
        let token_client = TokenClient::new(&env, &token);
        token_client.transfer(&lending_pool, &loan.borrower, &loan.amount);

        events::loan_approved(&env, loan_id);
        env.events()
            .publish((symbol_short!("LoanAppr"), loan.borrower.clone()), loan_id);
    }

    pub fn get_loan(env: Env, loan_id: u32) -> Loan {
        let loan_key = DataKey::Loan(loan_id);
        let loan = env
            .storage()
            .persistent()
            .get(&loan_key)
            .expect("loan not found");
        Self::bump_persistent_ttl(&env, &loan_key);
        loan
    }

    pub fn repay(env: Env, borrower: Address, amount: i128) {
        borrower.require_auth();
        Self::assert_not_paused(&env);

        if amount <= 0 {
            panic!("repayment amount must be positive");
        }

        // Repayment logic (placeholder)

        // Skip cross-contract call when repayment rounds to zero score points.
        if amount >= 100 {
            let nft_contract = Self::nft_contract(&env);
            let nft_client = NftClient::new(&env, &nft_contract);
            nft_client.update_score(&borrower, &amount, &None);
        }

        events::loan_repaid(&env, borrower, amount);
    }

    pub fn set_min_score(env: Env, min_score: u32) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        let old_score: u32 = env
            .storage()
            .instance()
            .get(&DataKey::MinScore)
            .unwrap_or(500);
        env.storage().instance().set(&DataKey::MinScore, &min_score);
        Self::bump_instance_ttl(&env);
        events::min_score_updated(&env, old_score, min_score);
    }

    pub fn get_min_score(env: Env) -> u32 {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::MinScore)
            .unwrap_or(500)
    }

    pub fn pause(env: Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        env.storage().instance().set(&DataKey::Paused, &true);
        Self::bump_instance_ttl(&env);
        events::paused(&env);
    }

    pub fn unpause(env: Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();

        env.storage().instance().set(&DataKey::Paused, &false);
        Self::bump_instance_ttl(&env);
        events::unpaused(&env);
    }
}

#[cfg(test)]
mod test;
