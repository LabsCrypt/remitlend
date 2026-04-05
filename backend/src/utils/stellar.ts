/**
 * utils/stellar.ts
 *
 * Stellar blockchain utilities: address validation, explorer links, etc.
 */

const STELLAR_EXPLORER_URL =
  process.env.STELLAR_EXPLORER_URL ?? "https://stellar.expert/explorer/testnet";

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
  if (!address || typeof address !== "string") return false;
  // Stellar public keys are exactly 56 characters, start with 'G'
  if (address.length !== 56 || !address.startsWith("G")) return false;
  // Check if it's valid base32 (only contains A-Z and 2-7)
  return /^G[A-Z2-7]{54}$/.test(address);
}

/**
 * Type guard for Stellar address strings
 */
export function assertValidStellarAddress(
  address: unknown,
  message: string = "Invalid Stellar address",
): asserts address is string {
  if (!isValidStellarAddress(address)) {
    throw new Error(message);
  }
}
