import { getAssetDecimals } from "./amount";

/**
 * Truncates a number string to a specified number of decimal places.
 * This is used to enforce precision limits on amount inputs.
 *
 * @param value The value to truncate
 * @param decimals The maximum number of decimals allowed
 * @returns The truncated value
 */
export function truncateDecimals(value: string, decimals: number): string {
  if (!value) return "";

  // Handle case where multiple decimal points might be typed
  const parts = value.split(".");
  if (parts.length > 2) {
    // Only keep first decimal part
    return `${parts[0]}.${parts[1].slice(0, decimals)}`;
  }

  if (parts.length === 2 && parts[1].length > decimals) {
    return `${parts[0]}.${parts[1].slice(0, decimals)}`;
  }

  return value;
}

/**
 * Gets the allowed decimal precision for a given asset.
 * Delegates to getAssetDecimals in amount.ts as the single source of truth.
 *
 * @param assetCode The asset code (e.g., 'XLM', 'USDC')
 * @returns The number of decimal places allowed
 */
export function getAssetPrecision(assetCode: string): number {
  return getAssetDecimals(assetCode);
}
