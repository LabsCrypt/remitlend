use std::path::Path;

use syn::{ImplItem, ImplItemFn, ItemImpl};
use syn::visit::{self, Visit};

use crate::{Diagnostic, Rule};

#[derive(Debug, Default, Clone, Copy)]
pub struct TtlExtensionRule;

impl TtlExtensionRule {
    pub const ID: &'static str = "SG002";

    fn check_function(&self, function: &ImplItemFn, diagnostics: &mut Vec<Diagnostic>) {
        if !is_public(&function.vis) {
            return;
        }

        let mut calls = StorageCalls::default();
        calls.visit_block(&function.block);

        if calls.uses_expiring_storage && !calls.extends_ttl {
            let start = function.sig.ident.span().start();
            diagnostics.push(Diagnostic {
                rule_id: Self::ID,
                message: format!(
                    "public contract function `{}` uses persistent or instance storage without an extend_ttl() call",
                    function.sig.ident
                ),
                function: function.sig.ident.to_string(),
                line: start.line,
                column: start.column + 1,
            });
        }
    }
}

impl Rule for TtlExtensionRule {
    fn id(&self) -> &'static str {
        Self::ID
    }

    fn name(&self) -> &'static str {
        "Storage operations require TTL extension"
    }

    fn check(&self, _path: &Path, source: &str) -> syn::Result<Vec<Diagnostic>> {
        let file = syn::parse_file(source)?;
        let mut diagnostics = Vec::new();

        for item in &file.items {
            if let syn::Item::Impl(item_impl) = item {
                if has_contractimpl_attribute(item_impl) {
                    for item in &item_impl.items {
                        if let ImplItem::Fn(function) = item {
                            self.check_function(function, &mut diagnostics);
                        }
                    }
                }
            }
        }

        Ok(diagnostics)
    }
}

fn is_public(visibility: &syn::Visibility) -> bool {
    matches!(visibility, syn::Visibility::Public(_))
}

fn has_contractimpl_attribute(item_impl: &ItemImpl) -> bool {
    item_impl.attrs.iter().any(|attribute| {
        attribute.path().segments.last().is_some_and(|segment| segment.ident == "contractimpl")
    })
}

#[derive(Default)]
struct StorageCalls {
    uses_expiring_storage: bool,
    extends_ttl: bool,
}

impl<'ast> Visit<'ast> for StorageCalls {
    fn visit_method_call(&mut self, call: &'ast syn::ExprMethodCall) {
        match call.method.to_string().as_str() {
            "persistent" | "instance" => self.uses_expiring_storage = true,
            "extend_ttl" => self.extends_ttl = true,
            _ => {}
        }
        visit::visit_expr_method_call(self, call);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn diagnostics(source: &str) -> Vec<Diagnostic> {
        TtlExtensionRule.check(Path::new("fixture.rs"), source).unwrap()
    }

    #[test]
    fn flags_public_persistent_storage_without_ttl_extension() {
        let result = diagnostics(include_str!("fixtures/sg002_persistent_missing_ttl.rs"));

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].rule_id, "SG002");
        assert_eq!(result[0].function, "read");
    }

    #[test]
    fn flags_public_instance_storage_without_ttl_extension() {
        let result = diagnostics(include_str!("fixtures/sg002_instance_missing_ttl.rs"));

        assert_eq!(result.len(), 1);
    }

    #[test]
    fn accepts_ttl_extension_for_either_storage_kind() {
        let result = diagnostics(include_str!("fixtures/sg002_with_ttl.rs"));

        assert!(result.is_empty());
    }

    #[test]
    fn ignores_private_helpers_and_non_contract_impls() {
        let result = diagnostics(
            r#"
            impl Contract {
                pub fn helper(env: Env) {
                    env.storage().persistent().get(&1u32);
                }
            }

            #[contractimpl]
            impl Contract {
                fn private(env: Env) {
                    env.storage().instance().get(&1u32);
                }
            }
            "#,
        );

        assert!(result.is_empty());
    }
}