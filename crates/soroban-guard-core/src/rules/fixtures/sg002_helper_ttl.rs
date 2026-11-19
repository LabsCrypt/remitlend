#[contractimpl]
impl Contract {
    fn bump_persistent_ttl(env: &Env, key: &u32) {
        env.storage().persistent().extend_ttl(key, 100, 200);
    }

    fn bump_instance_ttl(env: &Env) {
        env.storage().instance().extend_ttl(100, 200);
    }

    fn admin(env: &Env) -> u32 {
        Self::bump_instance_ttl(env);
        env.storage().instance().get(&0u32).unwrap()
    }

    pub fn read(env: Env) {
        env.storage().persistent().get(&1u32);
        Self::bump_persistent_ttl(&env, &1u32);
    }

    pub fn read_admin(env: Env) -> u32 {
        Self::admin(&env)
    }

    pub fn unbumped(env: Env) {
        let cache = env.storage().persistent();
        env.events().extend_ttl(100, 200);
        cache.get(&1u32);
    }
}
