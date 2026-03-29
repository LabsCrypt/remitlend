const EXPLORER_BASE_URL =
  process.env.NEXT_PUBLIC_STELLAR_EXPLORER_URL ?? "https://stellar.expert/explorer/testnet";

/**
 * Validates if a string is a valid Stellar public key
 * Stellar addresses are 56 characters long, start with 'G', and use base32 encoding
 */
export function isValidStellarAddress(address: string): boolean {
  if (!address || typeof address !== "string") return false;
  // Stellar public keys are exactly 56 characters, start with 'G'
  if (address.length !== 56 || !address.startsWith("G")) return false;
  // Check if it's valid base32 (only contains alphanumeric characters)
  return /^G[A-Z2-7]{54}$/.test(address);
}

export function getTxUrl(txHash: string): string {
  return `${EXPLORER_BASE_URL}/tx/${txHash}`;
}

export function getAccountUrl(address: string): string {
  return `${EXPLORER_BASE_URL}/account/${address}`;
}

export function truncateHash(hash: string, chars = 8): string {
  if (hash.length <= chars * 2 + 3) return hash;
  return `${hash.slice(0, chars)}...${hash.slice(-chars)}`;
}
