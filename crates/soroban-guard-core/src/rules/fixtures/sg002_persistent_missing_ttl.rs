#[contractimpl]
impl Contract {
    pub fn read(env: Env) {
        env.storage().persistent().get(&1u32);
    }
}