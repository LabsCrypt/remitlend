#!/usr/bin/env node

/**
 * check-env-docs.mjs
 *
 * Compares keys found in backend/.env.example and frontend/.env.example
 * against the tables listed in docs/ENVIRONMENT.md.
 *
 * The "unexpected" direction is scoped per section: keys from
 * docs/ENVIRONMENT.md are only compared against the section matching the
 * package (`## Backend` for backend/.env.example, `## Frontend` for
 * frontend/.env.example). Without this scoping, frontend-only keys such as
 * SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN were falsely flagged as
 * unexpected against backend/.env.example (see issue #1501).
 *
 * Exits with code 1 if any key is missing from either side.
 *
 * Usage:
 *   node scripts/check-env-docs.mjs
 */

import { readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

/** Section headings that scope an .env.example file's "unexpected" check. */
const BACKEND_SECTION = /^Backend\b/;
const FRONTEND_SECTION = /^Frontend\b/;

export function parseEnvKeys(content) {
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

/**
 * Splits the doc into `## `-headed sections and returns each section's keys,
 * keyed by heading text. Rows are recognized as `| \`KEY\` | ...` table rows.
 */
export function parseDocSections(content) {
  const sections = new Map();
  let current = null;
  for (const line of content.split("\n")) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      current = heading[1].trim();
      sections.set(current, []);
      continue;
    }
    if (current === null) continue;
    const row = line.match(/^\|\s*`([A-Z_][A-Z0-9_]*)`\s*\|/);
    if (row) sections.get(current).push(row[1]);
  }
  return sections;
}

/**
 * Returns the doc's keys as `{ all, backend, frontend }`, where `all` is the
 * union of every section (used for the "missing from docs" check) and
 * `backend` / `frontend` are scoped to the matching `## ` section (used for
 * the "unexpected" check).
 */
export function parseDocKeys(content) {
  const sections = parseDocSections(content);
  const all = [];
  const backend = [];
  const frontend = [];
  for (const [heading, keys] of sections) {
    all.push(...keys);
    if (BACKEND_SECTION.test(heading)) backend.push(...keys);
    if (FRONTEND_SECTION.test(heading)) frontend.push(...keys);
  }
  return { all, backend, frontend };
}

/**
 * Compares .env.example contents against the doc.
 *
 * @param {string} docContent Contents of docs/ENVIRONMENT.md
 * @param {Array<{label: string, content: string}>} envFiles .env.example contents keyed by label
 * @returns {{ errors: Array<{kind: string, label?: string, keys?: string[], section?: string}>, warnings: Array<{label: string, keys: string[]}> }}
 */
export function checkEnvDocs(docContent, envFiles) {
  const { all, backend, frontend } = parseDocKeys(docContent);
  const sectionKeys = { backend, frontend };

  const errors = [];
  const warnings = [];

  const sectionHeadings = [...parseDocSections(docContent).keys()];
  if (!sectionHeadings.some((h) => BACKEND_SECTION.test(h))) {
    errors.push({ kind: "missing-section", section: "Backend" });
  }
  if (!sectionHeadings.some((h) => FRONTEND_SECTION.test(h))) {
    errors.push({ kind: "missing-section", section: "Frontend" });
  }

  for (const { label, content } of envFiles) {
    const envKeys = parseEnvKeys(content);
    const isBackend = label.includes("backend");

    const missingInDoc = envKeys.filter((k) => !all.includes(k));
    if (missingInDoc.length > 0) {
      errors.push({ kind: "missing", label, keys: missingInDoc });
    }

    const unexpected = sectionKeys[isBackend ? "backend" : "frontend"].filter(
      (k) =>
        !envKeys.includes(k) &&
        (isBackend ? !k.startsWith("NEXT_PUBLIC_") : k.startsWith("NEXT_PUBLIC_"))
    );
    if (unexpected.length > 0) {
      warnings.push({ label, keys: unexpected });
    }
  }

  return { errors, warnings };
}

function run() {
  const envFiles = [
    { path: join(root, "backend", ".env.example"), label: "backend/.env.example" },
    { path: join(root, "frontend", ".env.example"), label: "frontend/.env.example" },
  ];

  const docPath = join(root, "docs", "ENVIRONMENT.md");
  const { errors, warnings } = checkEnvDocs(
    readFileSync(docPath, "utf-8"),
    envFiles.map(({ path, label }) => ({ label, content: readFileSync(path, "utf-8") }))
  );

  let exitCode = 0;

  for (const error of errors) {
    if (error.kind === "missing-section") {
      console.error(`\n❌ docs/ENVIRONMENT.md is missing '## ${error.section}' section`);
    } else {
      console.error(`\n❌ [${error.label}] Keys missing from docs/ENVIRONMENT.md:`);
      for (const k of error.keys) console.error(`   - ${k}`);
    }
    exitCode = 1;
  }

  for (const { label, keys } of warnings) {
    console.error(`\n⚠️  [${label}] Keys in docs/ENVIRONMENT.md but not in .env.example:`);
    for (const k of keys) console.error(`   - ${k}`);
  }

  if (exitCode === 0) {
    console.log("✅ docs/ENVIRONMENT.md is in sync with all .env.example files.");
  }

  process.exit(exitCode);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}
