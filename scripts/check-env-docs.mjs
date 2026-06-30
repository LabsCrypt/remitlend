#!/usr/bin/env node

/**
 * check-env-docs.mjs
 *
 * Compares keys found in backend/.env.example and frontend/.env.example
 * against the tables listed in docs/ENVIRONMENT.md.
 *
 * Exits with code 1 if any key is missing from either side.
 *
 * Usage:
 *   node scripts/check-env-docs.mjs
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function parseEnvKeys(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const keys = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    keys.push(trimmed.slice(0, eqIdx).trim());
  }
  return keys;
}

function parseDocKeys(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const keys = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^\|\s*`([A-Z_][A-Z0-9_]*)`\s*\|/);
    if (match) {
      keys.push(match[1]);
    }
  }
  return keys;
}

const envFiles = [
  { path: join(root, "backend", ".env.example"), label: "backend/.env.example" },
  { path: join(root, "frontend", ".env.example"), label: "frontend/.env.example" },
];

const docPath = join(root, "docs", "ENVIRONMENT.md");
const docKeys = new Set(parseDocKeys(docPath));

let exitCode = 0;

for (const { path, label } of envFiles) {
  const envKeys = parseEnvKeys(path);
  const missingInDoc = envKeys.filter((k) => !docKeys.has(k));
  const unexpected = [...docKeys].filter(
    (k) => !envKeys.includes(k) && (label.includes("backend") ? !k.startsWith("NEXT_PUBLIC_") : k.startsWith("NEXT_PUBLIC_"))
  );

  if (missingInDoc.length > 0) {
    console.error(`\n❌ [${label}] Keys missing from docs/ENVIRONMENT.md:`);
    for (const k of missingInDoc) console.error(`   - ${k}`);
    exitCode = 1;
  }

  if (unexpected.length > 0) {
    console.error(`\n⚠️  [${label}] Keys in docs/ENVIRONMENT.md but not in .env.example:`);
    for (const k of unexpected) console.error(`   - ${k}`);
  }
}

// Also check that doc has the backend and frontend sections
const docContent = readFileSync(docPath, "utf-8");
if (!docContent.includes("## Backend")) {
  console.error("\n❌ docs/ENVIRONMENT.md is missing '## Backend' section");
  exitCode = 1;
}
if (!docContent.includes("## Frontend")) {
  console.error("\n❌ docs/ENVIRONMENT.md is missing '## Frontend' section");
  exitCode = 1;
}

if (exitCode === 0) {
  console.log("✅ docs/ENVIRONMENT.md is in sync with all .env.example files.");
}

process.exit(exitCode);
