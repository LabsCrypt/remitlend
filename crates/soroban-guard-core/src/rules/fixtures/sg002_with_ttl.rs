#[contractimpl]
impl Contract {
    pub fn read(env: Env) {
        env.storage().persistent().extend_ttl(100, 200);
        env.storage().persistent().get(&1u32);
    }

    pub fn write(env: Env) {
        let storage = env.storage().instance();
        storage.extend_ttl(100, 200);
        storage.set(&1u32, &2u32);
    }
}