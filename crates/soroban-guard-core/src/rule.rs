use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub rule_id: &'static str,
    pub message: String,
    pub function: String,
    pub line: usize,
    pub column: usize,
}

pub trait Rule {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn check(&self, path: &Path, source: &str) -> syn::Result<Vec<Diagnostic>>;
}