/**
 * Issue #1378: cross-layer money-policy round-trip property test.
 *
 * Simulates the full pipeline a settlement amount travels through:
 *
 *   contract (i128 stroops)
 *     -> Postgres NUMERIC(38,0) (exact integer stroops, string-serialized)
 *     -> frontend display string (`formatStroops`, full 7dp settlement
 *        precision — the precision a "confirm before you sign" screen must
 *        use, never the 2dp presentation-only precision)
 *     -> user re-parses that exact string (`parseAmount`)
 *     -> back to stroops
 *
 * and asserts zero drift at every step, for a configurable number of
 * randomized cases. Contract-side agreement is covered separately by
 * `cargo test -p money` (`round_div`/`split_pro_rata` unit tests, which use
 * the identical fixtures transcribed into
 * `backend/src/__tests__/decimal.test.ts` and `frontend/lib/money/format.test.ts`);
 * this script exercises the backend <-> frontend leg of the pipeline inside
 * a single Node process using the actual generated/hand-authored modules
 * from both layers (no reimplementation), which is the leg that isn't
 * otherwise covered by a single test run.
 *
 * Usage:
 *   npx ts-node scripts/money-property-test.ts [caseCount] [seed]
 *
 * Exits non-zero (and prints the first failing case) on any drift.
 */
import { toStroops as backendToStroops, fromStroops as backendFromStroops } from '../backend/src/money/decimal.js';
import { formatStroops, parseAmount, STROOP_DECIMALS } from '../frontend/lib/money/format.js';

// Deterministic xorshift32 PRNG so a reported seed reproduces the exact run.
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

function randomStroops(next: () => number): bigint {
  // Mix two 32-bit draws so we exercise magnitudes well beyond
  // Number.MAX_SAFE_INTEGER (~9e15), not just small amounts.
  const hi = BigInt(next());
  const lo = BigInt(next());
  const magnitude = (hi << 32n) | lo;
  const sign = next() % 2 === 0 ? 1n : -1n;
  // Keep within a plausible XLM stroop range (up to ~10 billion whole units)
  // rather than the full i128 range, since that's the domain the frontend
  // display path is actually exercised against.
  return sign * (magnitude % (10_000_000_000n * 10_000_000n));
}

function main(): void {
  const caseCount = Number.parseInt(process.argv[2] ?? '10000', 10);
  const seedArg = process.argv[3];
  const seed = seedArg !== undefined ? Number.parseInt(seedArg, 16) : 0x1378_1378;
  const next = makeRng(seed);

  let checked = 0;
  for (let i = 0; i < caseCount; i += 1) {
    const original = randomStroops(next);

    // contract -> DB: NUMERIC(38,0) round-trips an exact integer via its
    // string representation with no loss.
    const dbSerialized = original.toString();
    const fromDb = BigInt(dbSerialized);
    if (fromDb !== original) {
      console.error(`DB round-trip drift at case ${i}: ${original} -> ${fromDb}`);
      process.exit(1);
    }

    // DB -> backend exact decimal string (full settlement precision).
    const backendDisplay = backendFromStroops(fromDb);
    const backendReparsed = backendToStroops(backendDisplay);
    if (backendReparsed !== original) {
      console.error(
        `backend decimal.ts round-trip drift at case ${i}: ${original} -> "${backendDisplay}" -> ${backendReparsed}`,
      );
      process.exit(1);
    }

    // backend -> frontend display at *full settlement precision* -> parse.
    // This is the precision a confirmation screen must show before signing;
    // the 2dp `DISPLAY_DP` truncation is presentation-only and is
    // deliberately never fed back into `parseAmount` here.
    const frontendDisplay = formatStroops(original, { decimalPlaces: STROOP_DECIMALS });
    const frontendReparsed = parseAmount(frontendDisplay);
    if (frontendReparsed !== original) {
      console.error(
        `frontend format.ts round-trip drift at case ${i}: ${original} -> "${frontendDisplay}" -> ${frontendReparsed}`,
      );
      process.exit(1);
    }

    // Cross-check: backend and frontend must independently produce the
    // *same* full-precision display string for the same stroop value — this
    // is the actual "conversions aren't inverse operations across layers"
    // failure mode issue #1378 describes.
    if (backendDisplay !== frontendDisplay) {
      console.error(
        `backend/frontend display disagreement at case ${i}: ${original} -> backend="${backendDisplay}" frontend="${frontendDisplay}"`,
      );
      process.exit(1);
    }

    checked += 1;
  }

  console.log(
    `money-property-test: OK — ${checked} cases, zero drift, seed=0x${seed.toString(16)}`,
  );
}

main();
