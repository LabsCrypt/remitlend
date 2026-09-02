/**
 * Unit tests for scripts/check-env-docs.mjs (issue #1501).
 *
 * Verifies that doc keys are scoped to their `## Backend` / `## Frontend`
 * section so frontend-only keys are not flagged against backend/.env.example,
 * and that a key documented under the wrong section is still caught.
 *
 * Run with: node scripts/check-env-docs.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocKeys, checkEnvDocs } from "./check-env-docs.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(__dirname, "__fixtures__", "env-docs");

function loadFixture(name) {
  const dir = join(fixturesRoot, name);
  return {
    doc: readFileSync(join(dir, "ENVIRONMENT.md"), "utf-8"),
    envFiles: [
      {
        label: "backend/.env.example",
        content: readFileSync(join(dir, "backend.env.example"), "utf-8"),
      },
      {
        label: "frontend/.env.example",
        content: readFileSync(join(dir, "frontend.env.example"), "utf-8"),
      },
    ],
  };
}

test("parseDocKeys scopes keys to the Backend/Frontend sections", () => {
  const { doc } = loadFixture("correct-sections");
  const { all, backend, frontend } = parseDocKeys(doc);

  assert.ok(backend.includes("BACKEND_ONLY_KEY"));
  assert.ok(frontend.includes("NEXT_PUBLIC_API_URL"));
  assert.ok(frontend.includes("SENTRY_ORG"));
  assert.ok(!backend.includes("SENTRY_ORG"), "frontend key leaked into backend section keys");
  assert.ok(!frontend.includes("BACKEND_ONLY_KEY"), "backend key leaked into frontend section keys");
  // Non-Backend/Frontend sections still count for the "missing from docs" direction
  assert.ok(all.includes("DEMO_MODE"));
  assert.ok(all.includes("SOROBAN_RPC_URL"));
});

test("frontend-section keys are not flagged as unexpected for backend/.env.example (issue #1501)", () => {
  const { doc, envFiles } = loadFixture("correct-sections");
  const { errors, warnings } = checkEnvDocs(doc, envFiles);

  assert.deepEqual(errors, []);
  const backendUnexpected = warnings
    .filter((w) => w.label.includes("backend"))
    .flatMap((w) => w.keys);
  assert.ok(!backendUnexpected.includes("SENTRY_ORG"));
  assert.ok(!backendUnexpected.includes("SENTRY_PROJECT"));
  assert.ok(!backendUnexpected.includes("SENTRY_AUTH_TOKEN"));
});

test("a key documented under the wrong section is caught as unexpected", () => {
  const { doc, envFiles } = loadFixture("wrong-section");
  const { errors, warnings } = checkEnvDocs(doc, envFiles);

  assert.deepEqual(errors, []);
  const backendUnexpected = warnings
    .filter((w) => w.label.includes("backend"))
    .flatMap((w) => w.keys);
  // SENTRY_AUTH_TOKEN is a frontend key but the fixture doc lists it under
  // the Backend heading, so the backend check must flag it.
  assert.ok(backendUnexpected.includes("SENTRY_AUTH_TOKEN"));
  assert.ok(!backendUnexpected.includes("BACKEND_ONLY_KEY"));
});

test("genuinely undocumented .env.example keys still fail the check", () => {
  const { doc, envFiles } = loadFixture("correct-sections");
  const badEnv = [
    { label: "backend/.env.example", content: "BACKEND_ONLY_KEY=value\nUNDOCUMENTED_BACKEND_KEY=value\n" },
    envFiles[1],
  ];
  const { errors, warnings } = checkEnvDocs(doc, badEnv);

  const missing = errors.find((e) => e.kind === "missing");
  assert.ok(missing, "expected a 'missing' error");
  assert.ok(missing.keys.includes("UNDOCUMENTED_BACKEND_KEY"));
  assert.deepEqual(warnings, []);
});
