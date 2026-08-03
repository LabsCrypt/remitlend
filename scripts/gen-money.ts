/**
 * Cross-layer money-policy code generator.
 *
 * Reads the single source of truth at `/money-policy.json` and emits the
 * generated policy constant modules consumed by each layer:
 *
 *   - contracts/money/src/policy.rs
 *   - backend/src/money/policy.generated.ts
 *   - frontend/lib/money/policy.generated.ts
 *
 * The generated files hold *only* the policy constants (scale, rounding
 * mode, display precision, allocation strategy). The actual conversion
 * logic (`money::round_div` / `split_pro_rata` in Rust, `decimal.ts` in the
 * backend, `format.ts` in the frontend) is hand-authored and imports these
 * constants, so there is exactly one place — this file plus
 * `money-policy.json` — that decides what "correct" rounding means.
 *
 * Usage (from the repo root):
 *   npx ts-node scripts/gen-money.ts          # regenerate in place
 *   npx ts-node scripts/gen-money.ts --check  # exit 1 if regenerating would
 *                                              # change any file (used by CI)
 *
 * Re-running the generator with no policy change is a no-op (idempotent):
 * files are only rewritten when their content actually differs.
 */
import * as fs from 'fs';
import * as path from 'path';

type RoundingModeName = 'half_even' | 'half_up' | 'floor' | 'ceil';

interface MoneyPolicy {
  scale: number;
  mode: RoundingModeName;
  display_dp: number;
  allocation: 'largest_remainder';
}

const ROOT = path.resolve(__dirname, '..');
const POLICY_PATH = path.join(ROOT, 'money-policy.json');

const VALID_MODES: RoundingModeName[] = ['half_even', 'half_up', 'floor', 'ceil'];

function loadPolicy(): MoneyPolicy {
  const raw = fs.readFileSync(POLICY_PATH, 'utf8');
  const parsed = JSON.parse(raw) as Partial<MoneyPolicy>;

  if (!Number.isInteger(parsed.scale) || (parsed.scale as number) <= 0) {
    throw new Error(`money-policy.json: "scale" must be a positive integer, got ${parsed.scale}`);
  }
  if (!parsed.mode || !VALID_MODES.includes(parsed.mode)) {
    throw new Error(
      `money-policy.json: "mode" must be one of ${VALID_MODES.join(', ')}, got ${parsed.mode}`,
    );
  }
  if (!Number.isInteger(parsed.display_dp) || (parsed.display_dp as number) < 0) {
    throw new Error(
      `money-policy.json: "display_dp" must be a non-negative integer, got ${parsed.display_dp}`,
    );
  }
  if (parsed.allocation !== 'largest_remainder') {
    throw new Error(
      `money-policy.json: "allocation" must be "largest_remainder", got ${parsed.allocation}`,
    );
  }

  return parsed as MoneyPolicy;
}

const GENERATED_HEADER = [
  '// GENERATED FILE — do not edit by hand.',
  '//',
  '// Derived from `money-policy.json` at the repository root by',
  '// `scripts/gen-money.ts`. Run `npx ts-node scripts/gen-money.ts` from the',
  "// repo root to regenerate. CI's `money-policy` job fails the build if this",
  '// file drifts from what the generator produces.',
].join('\n');

function genRust(policy: MoneyPolicy): string {
  const scale = 10 ** policy.scale;
  return `${GENERATED_HEADER}

/// Number of fractional decimal places a stroop-denominated amount carries
/// on-chain (\`10^scale\` stroops per whole unit).
pub const SCALE: u32 = ${policy.scale};

/// \`10^SCALE\`, i.e. the number of stroops in one whole unit.
pub const STROOP_SCALE: i128 = ${scale};

/// Default rounding mode applied when a division does not divide evenly.
/// Kept as a string (rather than \`crate::RoundingMode\`) so this generated
/// file never needs to import from hand-authored modules.
pub const DEFAULT_ROUNDING_MODE: &str = "${policy.mode}";

/// Number of decimal places used for user-facing display only. Settlement
/// math always uses the full \`SCALE\` precision.
pub const DISPLAY_DP: u32 = ${policy.display_dp};

/// Strategy used to allocate a total among weighted shares without losing or
/// fabricating units.
pub const ALLOCATION_STRATEGY: &str = "${policy.allocation}";
`;
}

/**
 * `backend/.prettierrc` and `frontend/.prettierrc` disagree on quote style
 * (single vs. double), and each workspace's `lint`/`format:check` enforces
 * its own — so the two generated files can't share one literal template
 * byte-for-byte. `quote` picks the right one per target; every other line is
 * identical between the two outputs.
 */
function genTs(policy: MoneyPolicy, quote: '"' | "'"): string {
  const q = (s: string): string => `${quote}${s}${quote}`;
  const scale = 10 ** policy.scale;
  return `${GENERATED_HEADER}
//
// Deliberately dependency-free (no imports from hand-authored modules like
// decimal.ts/format.ts) so this file can never form an import cycle with the
// logic that consumes it. \`MODE\` is a plain string union rather than the
// \`RoundingMode\` enum for the same reason — consumers map it to their own
// enum.
//
// Uses \`BigInt(...)\` rather than a \`123n\` literal so this file type-checks
// under the frontend's ES2017 \`tsconfig.json\` target too (BigInt literal
// syntax requires ES2020+; the runtime value is identical either way).

/** Number of fractional decimal places a stroop amount carries on-chain. */
export const SCALE_DECIMALS = ${policy.scale};

/** \`BigInt(10) ** BigInt(SCALE_DECIMALS)\`, i.e. stroops per whole unit. */
export const SCALE: bigint = BigInt(${scale});

/** Default rounding mode every layer must agree on for settlement math. */
export const MODE = ${q(policy.mode)} as const;

/**
 * Fractional digits used for *display only* — settlement always uses
 * \`SCALE_DECIMALS\` (full stroop precision).
 */
export const DISPLAY_DP = ${policy.display_dp};

/** Strategy used to allocate a total among weighted shares. */
export const ALLOCATION_STRATEGY = ${q(policy.allocation)} as const;
`;
}

function readFileIfExists(targetPath: string): string | null {
  // Read directly and handle ENOENT, rather than `existsSync` followed by a
  // separate `readFileSync` — the latter is a check-then-use race (the file
  // could be created/removed between the two calls) that CodeQL flags as a
  // TOCTOU file system race condition.
  try {
    return fs.readFileSync(targetPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

function writeIfChanged(targetPath: string, content: string): boolean {
  const existing = readFileIfExists(targetPath);
  if (existing === content) {
    return false;
  }
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, 'utf8');
  return true;
}

function main(): void {
  const policy = loadPolicy();
  const checkOnly = process.argv.includes('--check');

  const targets: Array<{ file: string; content: string }> = [
    { file: 'contracts/money/src/policy.rs', content: genRust(policy) },
    { file: 'backend/src/money/policy.generated.ts', content: genTs(policy, "'") },
    { file: 'frontend/lib/money/policy.generated.ts', content: genTs(policy, '"') },
  ];

  let anyChanged = false;
  for (const { file, content } of targets) {
    const changed = writeIfChanged(path.join(ROOT, file), content);
    anyChanged = anyChanged || changed;
    console.log(`${changed ? (checkOnly ? 'STALE ' : 'wrote ') : 'ok    '}${file}`);
  }

  if (checkOnly && anyChanged) {
    console.error(
      '\nmoney-policy: generated files are out of date with money-policy.json.\n' +
        'Run `npx ts-node scripts/gen-money.ts` from the repo root and commit the diff.',
    );
    process.exit(1);
  }
}

main();
