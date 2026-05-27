/**
 * Amount decimal precision utilities for Stellar network compliance.
 *
 * Stellar supports max 7 decimal places for XLM and custom assets,
 * while stablecoins like USDC / EURC typically use 2 decimal places.
 */

/** Maximum decimal places allowed per asset type on the Stellar network. */
export const ASSET_DECIMALS: Record<string, number> = {
  XLM: 7,
  USDC: 2,
  EURC: 2,
  PHP: 2,
};

/** Default decimal precision when the asset is unknown. */
const DEFAULT_DECIMALS = 7;

/** Get the max decimal places for a given asset code. */
export function getAssetDecimals(asset: string | undefined | null): number {
  if (!asset) return DEFAULT_DECIMALS;
  return ASSET_DECIMALS[asset.toUpperCase()] ?? DEFAULT_DECIMALS;
}

/** Get the HTML step attribute value for a given asset (e.g. "0.01" for USDC). */
export function getAssetStep(asset: string): string {
  const decimals = getAssetDecimals(asset);
  if (decimals === 0) return "1";
  return `0.${"0".repeat(decimals - 1)}1`;
}

/** Get human-readable helper text describing the precision limit. */
export function getAssetPrecisionHelperText(asset: string): string {
  const decimals = getAssetDecimals(asset);
  return `Max ${decimals} decimal place${decimals !== 1 ? "s" : ""} for ${asset}`;
}

/**
 * Truncate a numeric string to the allowed decimal places for the given asset.
 * Does NOT round — it simply truncates excess decimals.
 *
 * @example
 * truncateToAssetPrecision("123.456789", "USDC") // "123.45"
 * truncateToAssetPrecision("123.456789", "XLM")  // "123.4567890" (7 decimals)
 */
export function truncateToAssetPrecision(value: string, asset: string): string {
  const decimals = getAssetDecimals(asset);
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  return num.toFixed(decimals);
}

/** Validate that an amount string has the correct number of decimals for the asset. */
export function validateAmountPrecision(value: string, asset: string): string | undefined {
  if (!value) return undefined;
  const decimals = getAssetDecimals(asset);
  const parts = value.split(".");
  if (parts.length > 1 && parts[1].length > decimals) {
    return `Max ${decimals} decimal places for ${asset.toUpperCase()}`;
  }

  return undefined;
}

/**
 * Format a value on blur to the correct decimal precision for the given asset.
 * Returns the formatted string or the original value if it cannot be parsed.
 */
export function formatAmountOnBlur(value: string, asset: string): string {
  if (!value) return value;
  const num = parseFloat(value);
  if (isNaN(num)) return value;
  const decimals = getAssetDecimals(asset);
  return num.toFixed(decimals);
}
