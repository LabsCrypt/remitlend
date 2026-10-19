use std::{env, fs, path::PathBuf, process::ExitCode};

use soroban_guard_core::{rules::all_rules, Rule};
use walkdir::WalkDir;

fn main() -> ExitCode {
    let roots: Vec<PathBuf> = env::args_os().skip(1).map(PathBuf::from).collect();
    let roots = if roots.is_empty() {
        vec![PathBuf::from(".")]
    } else {
        roots
    };
    let rules = all_rules();
    let mut failed = false;

    for root in roots {
        for entry in WalkDir::new(&root).into_iter().filter_map(Result::ok) {
            let path = entry.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("rs") {
                continue;
            }

            let source = match fs::read_to_string(path) {
                Ok(source) => source,
                Err(error) => {
                    eprintln!("{}: {error}", path.display());
                    failed = true;
                    continue;
                }
            };

            for rule in &rules {
                match rule.check(path, &source) {
                    Ok(diagnostics) => {
                        for diagnostic in diagnostics {
                            println!(
                                "{}:{}:{}: {} {}",
                                path.display(),
                                diagnostic.line,
                                diagnostic.column,
                                diagnostic.rule_id,
                                diagnostic.message
                            );
                            failed = true;
                        }
                    }
                    Err(error) => {
                        eprintln!("{}: failed to parse: {error}", path.display());
                        failed = true;
                    }
                }
            }
        }
    }

    if failed { ExitCode::from(1) } else { ExitCode::SUCCESS }
}