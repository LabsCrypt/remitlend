/**
 * utils/stellar.ts
 *
 * Stellar blockchain utilities: address validation, explorer links, etc.
 */
import {
  DEFAULT_MODE,
  MoneyError,
  RoundingMode,
  STROOP_DECIMALS,
  fromStroops,
  toStroops,
} from '../money/decimal.js';

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

/** Maximum byte length of a Stellar MEMO_TEXT value. */
export const STELLAR_MAX_MEMO_BYTES = 28;

/** Validates a Stellar MEMO_TEXT value using UTF-8 byte length, not character count. */
export const isValidStellarMemo = (memo: unknown): memo is string =>
  typeof memo === 'string' && Buffer.byteLength(memo, 'utf8') <= STELLAR_MAX_MEMO_BYTES;

type StellarMemoCheck = (memo: unknown, message?: string) => asserts memo is string;

export const assertValidStellarMemo: StellarMemoCheck = (
  memo,
  message = 'Invalid Stellar memo: maximum length is 28 bytes',
) => {
  if (!isValidStellarMemo(memo)) {
    throw new Error(message);
  }
};

const STELLAR_ASSET_CODE_REGEX = /^(?:native|XLM|[A-Z0-9]{1,12})$/i;

/** Validates a Stellar asset code (native/XLM or a 1-12 character alphanumeric code). */
export const isValidAssetCode = (code: unknown): code is string =>
  typeof code === 'string' && STELLAR_ASSET_CODE_REGEX.test(code);

type StellarAssetCodeCheck = (code: unknown, message?: string) => asserts code is string;

export const assertValidAssetCode: StellarAssetCodeCheck = (
  code,
  message = 'Invalid Stellar asset code: must be 1-12 alphanumeric characters or native',
) => {
  if (!isValidAssetCode(code)) {
    throw new Error(message);
  }
};

const invalidStellarAmount = (): never => {
  throw new Error('Invalid Stellar amount: must be a non-negative finite decimal');
};

const numberToPlainDecimal = (value: number): string => {
  const text = value.toString();
  const [mantissa, exponentText] = text.toLowerCase().split('e');
  if (!mantissa || exponentText === undefined) return text;

  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent)) return invalidStellarAmount();

  const negative = mantissa.startsWith('-');
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const digits = `${whole}${fraction}`;
  const decimalPoint = whole.length + exponent;

  let normalized: string;
  if (decimalPoint <= 0) {
    normalized = `0.${'0'.repeat(-decimalPoint)}${digits}`;
  } else if (decimalPoint >= digits.length) {
    normalized = `${digits}${'0'.repeat(decimalPoint - digits.length)}`;
  } else {
    normalized = `${digits.slice(0, decimalPoint)}.${digits.slice(decimalPoint)}`;
  }

  return negative ? `-${normalized}` : normalized;
};

/**
 * Parses a non-negative Stellar amount into exact stroops.
 *
 * Decimal math is delegated to the repository money policy so precision and
 * tie-breaking stay identical across the backend, contracts, and frontend.
 */
export const parseStellarAmount = (
  amount: number | string,
  mode: RoundingMode = DEFAULT_MODE,
): bigint => {
  if (typeof amount !== 'number' && typeof amount !== 'string') return invalidStellarAmount();
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount) || amount < 0) return invalidStellarAmount();
  }

  const normalized = typeof amount === 'number' ? numberToPlainDecimal(amount) : amount.trim();
  if (!normalized || normalized.startsWith('-')) return invalidStellarAmount();

  try {
    return toStroops(normalized, mode);
  } catch (error) {
    if (error instanceof MoneyError) return invalidStellarAmount();
    throw error;
  }
};

/** Formats a non-negative Stellar amount at exact stroop precision. */
export const formatStellarAmount = (
  amount: number | string,
  mode: RoundingMode = DEFAULT_MODE,
): string => fromStroops(parseStellarAmount(amount, mode));

export { STROOP_DECIMALS };
