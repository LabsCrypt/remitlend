export interface LoanConfig {
  minScore: number;
  maxAmount: number;
  interestRatePercent: number;
  creditScoreThreshold: number;
}

const LOAN_MIN_SCORE = 'LOAN_MIN_SCORE';
const LOAN_MAX_AMOUNT = 'LOAN_MAX_AMOUNT';
const LOAN_INTEREST_RATE_PERCENT = 'LOAN_INTEREST_RATE_PERCENT';
const CREDIT_SCORE_THRESHOLD = 'CREDIT_SCORE_THRESHOLD';

const LOAN_MIN_SCORE_RANGE = { min: 300, max: 850 };
const LOAN_MAX_AMOUNT_RANGE = { min: 1, max: 1_000_000 }; // 0 is invalid as requested
const INTEREST_RATE_PERCENT_RANGE = { min: 1, max: 100 };
const CREDIT_SCORE_THRESHOLD_RANGE = { min: 300, max: 850 };

function parseRequiredInteger(envKey: string, min: number, max: number): number {
  const rawValue = process.env[envKey];
  if (rawValue === undefined || rawValue.trim() === '') {
    throw new Error(`${envKey} is required but missing`);
  }

  const trimmed = rawValue.trim();
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== trimmed) {
    throw new Error(`${envKey} must be a valid integer, got "${rawValue}"`);
  }

  if (parsed < min || parsed > max) {
    throw new Error(`${envKey} must be between ${min} and ${max} (inclusive), got ${parsed}`);
  }

  return parsed;
}

function parseRequiredNumber(envKey: string, min: number, max: number): number {
  const rawValue = process.env[envKey];
  if (rawValue === undefined || rawValue.trim() === '') {
    throw new Error(`${envKey} is required but missing`);
  }

  const trimmed = rawValue.trim();
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || String(parsed) !== trimmed) {
    throw new Error(`${envKey} must be a valid number, got "${rawValue}"`);
  }

  if (parsed < min || parsed > max) {
    throw new Error(`${envKey} must be between ${min} and ${max} (inclusive), got ${parsed}`);
  }

  return parsed;
}

export function getLoanConfig(): LoanConfig {
  return {
    minScore: parseRequiredInteger(
      LOAN_MIN_SCORE,
      LOAN_MIN_SCORE_RANGE.min,
      LOAN_MIN_SCORE_RANGE.max,
    ),
    maxAmount: parseRequiredInteger(
      LOAN_MAX_AMOUNT,
      LOAN_MAX_AMOUNT_RANGE.min,
      LOAN_MAX_AMOUNT_RANGE.max,
    ),
    interestRatePercent: parseRequiredNumber(
      LOAN_INTEREST_RATE_PERCENT,
      INTEREST_RATE_PERCENT_RANGE.min,
      INTEREST_RATE_PERCENT_RANGE.max,
    ),
    creditScoreThreshold: parseRequiredInteger(
      CREDIT_SCORE_THRESHOLD,
      CREDIT_SCORE_THRESHOLD_RANGE.min,
      CREDIT_SCORE_THRESHOLD_RANGE.max,
    ),
  };
}

export function validateLoanConfig(): LoanConfig {
  const loanConfig = getLoanConfig();
  return loanConfig;
}

/**
 * Startup guard — mirrors validateEnvVars().
 * Calls getLoanConfig() and, on any validation failure, logs the error and
 * terminates the process immediately so the server never starts with bad loan
 * parameters.
 */
export function validateLoanConfigOnStartup(): void {
  try {
    getLoanConfig();
  } catch (err) {
    const boldRed = (msg: string) => `\x1b[1;31m${msg}\x1b[0m`;
    const bold = (msg: string) => `\x1b[1m${msg}\x1b[0m`;

    const errorPrefix = boldRed('FATAL ERROR: Loan config validation failed');
    const detail = bold(err instanceof Error ? err.message : String(err));
    const actionMsg = `Please verify the loan config variables in your \x1b[4m.env\x1b[0m file.`;

    console.error(`\n${errorPrefix}\n${detail}\n${actionMsg}\n`);
    process.exit(1);
  }
}
