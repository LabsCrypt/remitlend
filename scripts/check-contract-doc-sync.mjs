#!/usr/bin/env node

/**
 * check-contract-doc-sync.mjs
 *
 * Verifies that contract entrypoint names and access-control sections documented
 * in ARCHITECTURE.md match actual #[contractimpl] blocks in the Soroban contracts.
 *
 * Exits with code 1 if documented entrypoints drift from the code or if any
 * documented method does not exist in the contract implementation.
 *
 * Usage:
 *   node scripts/check-contract-doc-sync.mjs
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

export const CONTRACT_MAPPINGS = {
  "Remittance NFT": "contracts/remittance_nft/src/lib.rs",
  "Loan Manager": "contracts/loan_manager/src/lib.rs",
  "Lending Pool": "contracts/lending_pool/src/lib.rs",
  "Multisig Governance": "contracts/multisig_governance/src/lib.rs",
};

/**
 * Extracts public function names declared inside #[contractimpl] blocks in Rust source code.
 */
export function parseContractImplMethods(rustSource) {
  const methods = new Set();
  const implRegex = /#\[contractimpl\]\s*impl(?:\s+<[^>]+>)?\s+\w+(?:\s+for\s+\w+)?\s*\{/g;
  let match;

  while ((match = implRegex.exec(rustSource)) !== null) {
    const startIndex = match.index + match[0].length;
    let depth = 1;
    let endIndex = startIndex;

    while (endIndex < rustSource.length && depth > 0) {
      const char = rustSource[endIndex];
      if (char === "{") depth++;
      else if (char === "}") depth--;
      endIndex++;
    }

    const body = rustSource.slice(startIndex, endIndex - 1);
    const fnRegex = /pub fn\s+(\w+)\s*\(/g;
    let fnMatch;
    while ((fnMatch = fnRegex.exec(body)) !== null) {
      methods.add(fnMatch[1]);
    }
  }

  return methods;
}

/**
 * Parses documented contract entrypoints from ARCHITECTURE.md access-control sections.
 * Returns a Map of contract name -> Set of documented entrypoint names.
 */
export function parseDocumentedMethods(markdownContent) {
  const result = new Map();
  for (const name of Object.keys(CONTRACT_MAPPINGS)) {
    result.set(name, new Set());
  }

  // Look for contract headings such as:
  // **Remittance NFT Contract**: or ### Remittance NFT Contract
  const lines = markdownContent.split("\n");
  let currentContract = null;
  let inAccessControl = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("### Access Control") || trimmed.startsWith("## Access Control")) {
      inAccessControl = true;
      continue;
    }

    if (inAccessControl && (trimmed.startsWith("## ") || trimmed.startsWith("# "))) {
      // Exited access control section into next major section
      break;
    }

    if (!inAccessControl) {
      continue;
    }

    // Check for contract header
    for (const name of Object.keys(CONTRACT_MAPPINGS)) {
      if (
        trimmed.includes(`**${name}`) ||
        trimmed.includes(`### ${name}`) ||
        trimmed.includes(`#### ${name}`)
      ) {
        currentContract = name;
        break;
      }
    }

    if (!currentContract) continue;

    // Check for documented entrypoints in format:
    // - `entrypoint_name`: description
    // or - `entrypoint1`, `entrypoint2`: description
    if (trimmed.startsWith("-") || trimmed.startsWith("*")) {
      const codeMatches = trimmed.matchAll(/`([a-z0-9_]+)`/g);
      for (const m of codeMatches) {
        const fnName = m[1];
        // Filter out non-function tokens or keywords if needed
        result.get(currentContract)?.add(fnName);
      }
    }
  }

  return result;
}

export function runChecks({ docPath, repoRoot } = {}) {
  const docFile = docPath || join(root, "ARCHITECTURE.md");
  const baseDir = repoRoot || root;

  const docContent = readFileSync(docFile, "utf-8");
  const documented = parseDocumentedMethods(docContent);

  let hasError = false;

  for (const [contractName, relPath] of Object.entries(CONTRACT_MAPPINGS)) {
    const fullPath = join(baseDir, relPath);
    let rustSource;
    try {
      rustSource = readFileSync(fullPath, "utf-8");
    } catch (err) {
      console.error(`❌ Could not read contract source: ${relPath} (${err.message})`);
      hasError = true;
      continue;
    }

    const actualMethods = parseContractImplMethods(rustSource);
    const docMethods = documented.get(contractName) || new Set();

    if (docMethods.size === 0) {
      console.error(`❌ No documented entrypoints found for ${contractName} in ${docFile}`);
      hasError = true;
      continue;
    }

    const missingMethods = [];
    for (const method of docMethods) {
      if (!actualMethods.has(method)) {
        missingMethods.push(method);
      }
    }

    if (missingMethods.length > 0) {
      console.error(
        `❌ ${contractName}: documented entrypoint(s) [${missingMethods.join(", ")}] not found in #[contractimpl] in ${relPath}`
      );
      hasError = true;
    } else {
      console.log(
        `✅ ${contractName}: all ${docMethods.size} documented entrypoints match #[contractimpl] in ${relPath}`
      );
    }
  }

  return !hasError;
}

// Run CLI if invoked directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log("Checking contract documentation sync against code...");
  const success = runChecks();
  if (!success) {
    console.error("\nDoc sync check failed! Please fix entrypoint discrepancies.");
    process.exit(1);
  }
  console.log("\nAll contract documentation is in sync with code!");
}
