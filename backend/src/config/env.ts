import logger from "../utils/logger.js";

/**
 * List of environment variables required for the application to function.
 * If any of these are missing or empty on startup, the server will exit immediately
 * with a clear error message.
 */
const REQUIRED_ENV_VARS = [
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_SECRET",
  "STELLAR_RPC_URL",
  "STELLAR_NETWORK_PASSPHRASE",
  "LOAN_MANAGER_CONTRACT_ID",
  "LENDING_POOL_CONTRACT_ID",
  "POOL_TOKEN_ADDRESS",
  "LOAN_MANAGER_ADMIN_SECRET",
  "INTERNAL_API_KEY",
];

/**
 * Validates that all critical environment variables are set and non-empty.
 * Logs a clear error message and halts the process if any requirements are unmet.
 */
export function validateEnvVars(): void {
  // Filter for variables that are either absent OR just whitespace
  const missing = REQUIRED_ENV_VARS.filter(
    (key) => !process.env[key] || process.env[key]!.trim() === "",
  );

  if (missing.length > 0) {
    const boldRed = (msg: string) => `\x1b[1;31m${msg}\x1b[0m`;
    const bold = (msg: string) => `\x1b[1m${msg}\x1b[0m`;

    const errorPrefix = boldRed("FATAL ERROR: Environment validation failed");
    const missingVarMsg = `Missing or empty required variables: ${bold(missing.join(", "))}`;
    const actionMsg = `Please verify these variables in your \x1b[4m.env\x1b[0m file or deployment environment.`;

    // Direct console error for immediate visibility during startup failure
    console.error(`\n${errorPrefix}\n${missingVarMsg}\n${actionMsg}\n`);

    // Structured log for persistent logs (e.g., Sentry, CloudWatch, etc.)
    logger.error("Environment validation failure", {
      missing,
      node_env: process.env.NODE_ENV,
    });

    // Stop execution immediately
    process.exit(1);
  }

  logger.info("Environment variables validated successfully.");
}
