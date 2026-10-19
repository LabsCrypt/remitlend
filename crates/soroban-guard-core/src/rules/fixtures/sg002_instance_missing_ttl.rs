#[contractimpl]
impl Contract {
    pub fn write(env: Env) {
        env.storage().instance().set(&1u32, &2u32);
    }
}