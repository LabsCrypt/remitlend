import { StrKey } from '@stellar/stellar-sdk';

/**
 * utils/stellar.ts
 *
 * Stellar blockchain utilities: address validation, explorer links, etc.
 */

const getExplorerBaseUrl = (): string =>
  process.env.STELLAR_EXPLORER_URL ?? 'https://stellar.expert/explorer/testnet';

/**
 * Get Stellar Explorer URL for a transaction hash
 */
export function getTxUrl(txHash: string): string {
  return `${getExplorerBaseUrl()}/tx/${txHash}`;
}

/**
 * Get Stellar Explorer URL for an account address
 */
export function getAccountUrl(address: string): string {
  return `${getExplorerBaseUrl()}/account/${address}`;
}

/**
 * Validates if a string is a valid Stellar public key (Ed25519)
 * Stellar addresses are 56 characters long, start with 'G', use base32 encoding,
 * and contain a valid CRC16-XMODEM checksum.
 *
 * Uses StrKey.isValidEd25519PublicKey from @stellar/stellar-sdk for authoritative
 * format and checksum validation (#1868).
 *
 * @param address - The Stellar address to validate
 * @returns True if valid, false otherwise
 */
export function isValidStellarAddress(address: unknown): address is string {
  if (!address || typeof address !== 'string') return false;
  return StrKey.isValidEd25519PublicKey(address);
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
