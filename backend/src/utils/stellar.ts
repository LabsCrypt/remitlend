/**
 * utils/stellar.ts
 *
 * Stellar blockchain utilities: address validation, explorer links, etc.
 */

const STELLAR_EXPLORER_URL =
  process.env.STELLAR_EXPLORER_URL ?? 'https://stellar.expert/explorer/testnet';

/**
 * Get Stellar Explorer URL for a transaction hash
 */
export function getTxUrl(txHash: string): string {
  return `${STELLAR_EXPLORER_URL}/tx/${txHash}`;
}

/**
 * Get Stellar Explorer URL for an account address
 */
export function getAccountUrl(address: string): string {
  return `${STELLAR_EXPLORER_URL}/account/${address}`;
}

/**
 * Validates if a string is a valid Stellar public key (Ed25519)
 * Stellar addresses are 56 characters long, start with 'G', and use base32 encoding
 *
 * @param address - The Stellar address to validate
 * @returns True if valid, false otherwise
 */
export function isValidStellarAddress(address: unknown): address is string {
  if (!address || typeof address !== 'string') return false;
  // Stellar public keys are exactly 56 characters, start with 'G'
  if (address.length !== 56 || !address.startsWith('G')) return false;
  // Check if it's valid base32 (only contains A-Z and 2-7)
  return /^G[A-Z2-7]{55}$/.test(address);
}

/**
 * Type guard for Stellar address strings
 */
export function assertValidStellarAddress(
  address: unknown,
  message: string = 'Invalid Stellar address',
): asserts address is string {
  if (!isValidStellarAddress(address)) {
    throw new Error(message);
  }
}

/**
 * Stellar MEMO_TEXT max length in bytes (28 bytes per Stellar protocol specification)
 */
export const STELLAR_MAX_MEMO_BYTES = 28;

/**
 * Validates if a string is a valid Stellar text memo (up to 28 bytes in UTF-8)
 */
export function isValidStellarMemo(memo: unknown): memo is string {
  if (memo === null || memo === undefined) return false;
  if (typeof memo !== 'string') return false;
  return Buffer.byteLength(memo, 'utf8') <= STELLAR_MAX_MEMO_BYTES;
}

/**
 * Asserts that a memo string satisfies the 28-byte Stellar text memo limit
 */
export function assertValidStellarMemo(
  memo: unknown,
  message: string = 'Invalid Stellar memo: maximum length is 28 bytes',
): asserts memo is string {
  if (!isValidStellarMemo(memo)) {
    throw new Error(message);
  }
}

/**
 * Stellar asset code pattern: 1-12 alphanumeric characters (AlphaNum4 or AlphaNum12),
 * or native / XLM.
 */
const STELLAR_ASSET_CODE_REGEX = /^(?:native|XLM|[a-zA-Z0-9]{1,12})$/;

/**
 * Validates if a string is a valid Stellar asset code
 */
export function isValidAssetCode(code: unknown): code is string {
  if (!code || typeof code !== 'string') return false;
  return STELLAR_ASSET_CODE_REGEX.test(code);
}

/**
 * Asserts that an asset code is valid
 */
export function assertValidAssetCode(
  code: unknown,
  message: string = 'Invalid Stellar asset code: must be 1-12 alphanumeric characters or native',
): asserts code is string {
  if (!isValidAssetCode(code)) {
    throw new Error(message);
  }
}

/**
 * Formats a numeric amount to standard Stellar 7 decimal precision (stroops representation),
 * with exact rounding to avoid floating-point drift.
 */
export function formatStellarAmount(amount: number | string, decimals: number = 7): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (!Number.isFinite(num) || num < 0) {
    throw new Error('Invalid Stellar amount: must be a non-negative finite number');
  }
  const factor = Math.pow(10, decimals);
  const rounded = Math.round((num + Number.EPSILON) * factor) / factor;
  return rounded.toFixed(decimals);
}

/**
 * Parses an amount string or number into smallest stroop integer units (1 XLM = 10,000,000 stroops).
 */
export function parseStellarAmount(amount: number | string): bigint {
  const formatted = formatStellarAmount(amount, 7);
  const [whole = '0', fraction = ''] = formatted.split('.');
  const paddedFraction = fraction.padEnd(7, '0').slice(0, 7);
  return BigInt(whole) * 10000000n + BigInt(paddedFraction);
}
