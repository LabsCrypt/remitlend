pub mod sg002_ttl_check;

pub use sg002_ttl_check::TtlExtensionRule;

use crate::Rule;

pub fn all_rules() -> Vec<Box<dyn Rule>> {
	vec![Box::new(TtlExtensionRule)]
}