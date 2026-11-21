import logger from '../utils/logger.js';

/**
 * List of environment variables required for the application to function.
 * If any of these are missing or empty on startup, the server will exit immediately
 * with a clear error message.
 */
const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'STELLAR_RPC_URL',
  'STELLAR_NETWORK_PASSPHRASE',
  'LOAN_MANAGER_CONTRACT_ID',
  'LENDING_POOL_CONTRACT_ID',
  'REMITTANCE_NFT_CONTRACT_ID',
  'MULTISIG_GOVERNANCE_CONTRACT_ID',
  'POOL_TOKEN_ADDRESS',
  'LOAN_MANAGER_ADMIN_SECRET',
  'INTERNAL_API_KEY',
  'FRONTEND_URL',
  'SCORE_DELTA_REPAY',
  'SCORE_DELTA_DEFAULT',
  'SCORE_DELTA_LATE',
];

const MIN_SECRET_BYTES = 32;
const SECRET_ENV_VARS = ['JWT_SECRET', 'INTERNAL_API_KEY'] as const;

/**
 * Parses and validates `TRUST_PROXY_HOPS` as a non-negative integer hop count.
 * Defaults to `0` (do not trust proxy headers) for safe local development.
 */
export function parseTrustProxyHops(raw?: string): number {
  if (raw === undefined || raw.trim() === '') {
    return 0;
  }

  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      `Invalid TRUST_PROXY_HOPS value "${raw}": must be a non-negative integer (e.g. 0 for direct connections, 1 behind a single reverse proxy).`,
    );
  }

  const hops = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(hops)) {
    throw new Error(`Invalid TRUST_PROXY_HOPS value "${raw}": integer out of safe range.`);
  }

  return hops;
}

/**
 * Validates that all critical environment variables are set and non-empty.
 * Logs a clear error message and halts the process if any requirements are unmet.
 */
export function validateEnvVars(): void {
  // Filter for variables that are either absent OR just whitespace
  const missing = REQUIRED_ENV_VARS.filter(
    (key) => !process.env[key] || process.env[key]!.trim() === '',
  );

  if (missing.length > 0) {
    const boldRed = (msg: string) => `\x1b[1;31m${msg}\x1b[0m`;
    const bold = (msg: string) => `\x1b[1m${msg}\x1b[0m`;

    const errorPrefix = boldRed('FATAL ERROR: Environment validation failed');
    const missingVarMsg = `Missing or empty required variables: ${bold(missing.join(', '))}`;
    const actionMsg = `Please verify these variables in your \x1b[4m.env\x1b[0m file or deployment environment.`;

    // Direct console error for immediate visibility during startup failure
    console.error(`\n${errorPrefix}\n${missingVarMsg}\n${actionMsg}\n`);

    // Structured log for persistent logs (e.g., Sentry, CloudWatch, etc.)
    logger.error('Environment validation failure', {
      missing,
      node_env: process.env.NODE_ENV,
    });

    // Stop execution immediately
    process.exit(1);
  }

  // PII encryption requires either a KMS endpoint or a local KEK key.
  // Both missing means PII would be encrypted with a static all-zero key.
  const hasKmsEndpoint = process.env.PII_KMS_ENDPOINT && process.env.PII_KMS_ENDPOINT.trim() !== '';
  const hasKekKey = process.env.PII_KEK_KEY && process.env.PII_KEK_KEY.trim() !== '';

  if (!hasKmsEndpoint && !hasKekKey) {
    const boldRed = (msg: string) => `\x1b[1;31m${msg}\x1b[0m`;
    const bold = (msg: string) => `\x1b[1m${msg}\x1b[0m`;
    const errorPrefix = boldRed('FATAL ERROR: PII encryption misconfiguration');
    const msg = `PII_KEK_KEY or PII_KMS_ENDPOINT must be provided. ${bold('Both are missing.')}`;
    const actionMsg =
      'Set PII_KMS_ENDPOINT for remote KMS encryption or PII_KEK_KEY for local envelope encryption.';

    console.error(`\n${errorPrefix}\n${msg}\n${actionMsg}\n`);

    logger.error('PII encryption env validation failure', {
      hasKmsEndpoint,
      hasKekKey,
      node_env: process.env.NODE_ENV,
    });

    process.exit(1);
  }

  const weakSecrets = SECRET_ENV_VARS.filter(
    (key) => Buffer.byteLength(process.env[key]!.trim(), 'utf8') < MIN_SECRET_BYTES,
  );
  if (weakSecrets.length > 0) {
    const message = `Security-sensitive variables must be at least ${MIN_SECRET_BYTES} bytes: ${weakSecrets.join(', ')}`;
    console.error(`\n\x1b[1;31mFATAL ERROR: Environment validation failed\x1b[0m\n${message}\n`);
    logger.error('Environment validation failure', { weakSecrets, node_env: process.env.NODE_ENV });
    process.exit(1);
  }

  try {
    parseTrustProxyHops(process.env.TRUST_PROXY_HOPS);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n\x1b[1;31mFATAL ERROR: ${message}\x1b[0m\n`);
    logger.error('Invalid TRUST_PROXY_HOPS configuration', {
      value: process.env.TRUST_PROXY_HOPS,
      node_env: process.env.NODE_ENV,
    });
    process.exit(1);
  }

  logger.info('Environment variables validated successfully.');
}
