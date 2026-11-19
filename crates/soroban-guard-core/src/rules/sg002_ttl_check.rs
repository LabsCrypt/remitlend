use std::collections::HashMap;
use std::path::Path;

use syn::{ImplItem, ImplItemFn, ItemImpl};
use syn::visit::{self, Visit};

use crate::{Diagnostic, Rule};

#[derive(Debug, Default, Clone, Copy)]
pub struct TtlExtensionRule;

impl TtlExtensionRule {
    pub const ID: &'static str = "SG002";

    fn check_function(
        &self,
        function: &ImplItemFn,
        helpers: &HashMap<String, (bool, bool)>,
        diagnostics: &mut Vec<Diagnostic>,
    ) {
        if !is_public(&function.vis) {
            return;
        }

        let calls = StorageCalls::scan(function, helpers);

        if (calls.uses_persistent && !calls.extends_persistent_ttl)
            || (calls.uses_instance && !calls.extends_instance_ttl) {
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

        let functions: Vec<&ImplItemFn> = file
            .items
            .iter()
            .filter_map(|item| match item {
                syn::Item::Impl(item_impl) => Some(item_impl),
                _ => None,
            })
            .flat_map(|item_impl| item_impl.items.iter())
            .filter_map(|item| match item {
                ImplItem::Fn(function) => Some(function),
                _ => None,
            })
            .collect();

        // Resolve which helper functions extend TTL (transitively), so calls
        // like `Self::bump_persistent_ttl(&env, &key)` count as an extension.
        let mut helpers: HashMap<String, (bool, bool)> = HashMap::new();
        for _ in 0..=functions.len() {
            let mut changed = false;
            for function in &functions {
                let entry = {
                    let calls = StorageCalls::scan(function, &helpers);
                    (calls.extends_persistent_ttl, calls.extends_instance_ttl)
                };
                if helpers.get(&function.sig.ident.to_string()) != Some(&entry) {
                    helpers.insert(function.sig.ident.to_string(), entry);
                    changed = true;
                }
            }
            if !changed {
                break;
            }
        }

        for item in &file.items {
            if let syn::Item::Impl(item_impl) = item {
                if has_contractimpl_attribute(item_impl) {
                    for item in &item_impl.items {
                        if let ImplItem::Fn(function) = item {
                            self.check_function(function, &helpers, &mut diagnostics);
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

#[derive(Clone, Copy, PartialEq)]
enum StorageKind {
    Persistent,
    Instance,
}

struct StorageCalls<'h> {
    helpers: &'h HashMap<String, (bool, bool)>,
    locals: HashMap<String, StorageKind>,
    uses_persistent: bool,
    extends_persistent_ttl: bool,
    uses_instance: bool,
    extends_instance_ttl: bool,
}

impl<'h> StorageCalls<'h> {
    fn scan(function: &ImplItemFn, helpers: &'h HashMap<String, (bool, bool)>) -> Self {
        let mut calls = StorageCalls {
            helpers,
            locals: HashMap::new(),
            uses_persistent: false,
            extends_persistent_ttl: false,
            uses_instance: false,
            extends_instance_ttl: false,
        };
        calls.visit_block(&function.block);
        calls
    }

    /// Storage kind of an expression: `<..>.persistent()`, `<..>.instance()`,
    /// or a local bound to one of those. Anything else is unknown.
    fn storage_kind(&self, expr: &syn::Expr) -> Option<StorageKind> {
        match expr {
            syn::Expr::MethodCall(call) => match call.method.to_string().as_str() {
                "persistent" => Some(StorageKind::Persistent),
                "instance" => Some(StorageKind::Instance),
                _ => None,
            },
            syn::Expr::Path(path) => path
                .path
                .get_ident()
                .and_then(|ident| self.locals.get(&ident.to_string()).copied()),
            syn::Expr::Reference(reference) => self.storage_kind(&reference.expr),
            syn::Expr::Paren(paren) => self.storage_kind(&paren.expr),
            _ => None,
        }
    }
}

impl<'ast, 'h> Visit<'ast> for StorageCalls<'h> {
    fn visit_local(&mut self, local: &'ast syn::Local) {
        if let (syn::Pat::Ident(pat), Some(init)) = (&local.pat, &local.init) {
            if let Some(kind) = self.storage_kind(&init.expr) {
                self.locals.insert(pat.ident.to_string(), kind);
            }
        }
        visit::visit_local(self, local);
    }

    fn visit_expr_call(&mut self, call: &'ast syn::ExprCall) {
        if let syn::Expr::Path(path) = &*call.func {
            if let Some(segment) = path.path.segments.last() {
                if let Some(&(persistent, instance)) = self.helpers.get(&segment.ident.to_string()) {
                    self.extends_persistent_ttl |= persistent;
                    self.extends_instance_ttl |= instance;
                }
            }
        }
        visit::visit_expr_call(self, call);
    }

    fn visit_expr_method_call(&mut self, call: &'ast syn::ExprMethodCall) {
        match call.method.to_string().as_str() {
            "persistent" => self.uses_persistent = true,
            "instance" => self.uses_instance = true,
            "extend_ttl" => match self.storage_kind(&call.receiver) {
                Some(StorageKind::Persistent) => self.extends_persistent_ttl = true,
                Some(StorageKind::Instance) => self.extends_instance_ttl = true,
                None => {}
            },
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
    fn resolves_ttl_extension_through_helpers() {
        let result = diagnostics(include_str!("fixtures/sg002_helper_ttl.rs"));

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].function, "unbumped");
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