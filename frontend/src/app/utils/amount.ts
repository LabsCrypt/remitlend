export const STROOP_DECIMALS = 7;
export const STROOP_SCALE = 10 ** STROOP_DECIMALS;

// Asset-specific decimal precision
export const ASSET_DECIMALS: Record<string, number> = {
  XLM: 7,
  USDC: 2,
  EURC: 2,
  PHP: 2,
};

export function getAssetDecimals(asset: string): number {
  return ASSET_DECIMALS[asset] ?? STROOP_DECIMALS;
}

export function sanitizeAmountInput(value: string): string {
  let sanitized = value.replace(/[^\d.]/g, "");
  const firstDotIndex = sanitized.indexOf(".");
  if (firstDotIndex !== -1) {
    sanitized =
      sanitized.slice(0, firstDotIndex + 1) + sanitized.slice(firstDotIndex + 1).replace(/\./g, "");
  }
  return sanitized;
}

export function countFractionDigits(value: string): number {
  const [, fraction = ""] = value.split(".");
  return fraction.length;
}

export function hasInvalidPrecision(value: string, decimals = STROOP_DECIMALS): boolean {
  return countFractionDigits(value) > decimals;
}

export function parseAmount(value: string): number {
  return Number.parseFloat(value);
}

export function formatTypedAmount(
  value: string,
  decimals = STROOP_DECIMALS,
  locale = "en-US",
): string | null {
  const amount = parseAmount(value);
  if (!value || Number.isNaN(amount)) {
    return null;
  }

  return amount.toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export function toStroops(value: string, decimals = STROOP_DECIMALS): bigint | null {
  if (!value || hasInvalidPrecision(value, decimals)) {
    return null;
  }

  const [whole = "0", fraction = ""] = value.split(".");
  const normalizedFraction = fraction.padEnd(decimals, "0");

  try {
    // Scale by the requested precision, not the fixed 7-decimal stroop scale,
    // so non-XLM assets (e.g. 2-decimal USDC) convert correctly.
    const scale = BigInt(10) ** BigInt(decimals);
    return BigInt(whole || "0") * scale + BigInt(normalizedFraction || "0");
  } catch {
    return null;
  }
}

export function buildAmountHelperText(
  value: string,
  asset = "XLM",
  decimals = STROOP_DECIMALS,
  locale = "en-US",
): string | null {
  const formatted = formatTypedAmount(value, decimals, locale);
  if (!formatted) {
    return null;
  }

  const stroops = toStroops(value, decimals);
  if (stroops === null) {
    return `Formatted: ${formatted} ${asset}`;
  }

  return `Formatted: ${formatted} ${asset} • Stroops: ${stroops.toString()}`;
}

export function getPrecisionError(value: string, asset = "XLM", decimals?: number): string | null {
  const assetDecimals = decimals ?? getAssetDecimals(asset);
  if (!hasInvalidPrecision(value, assetDecimals)) {
    return null;
  }

  return `${asset} supports at most ${assetDecimals} decimal places.`;
}

export function formatAmountOnBlur(value: string, asset = "XLM"): string {
  const decimals = getAssetDecimals(asset);
  const parsed = parseAmount(value);
  if (!value || Number.isNaN(parsed)) {
    return "";
  }
  return parsed.toFixed(decimals);
}
