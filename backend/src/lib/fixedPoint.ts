/**
 * Fixed-point mathematical operations for loan interest index calculation (issue #1382).
 *
 * Reproduces the contract's 256-bit widened multiplication and half-up rounding
 * bit-for-bit to ensure cross-layer parity across contracts, backend, and frontend.
 */

export const INDEX_SCALE = 1_000_000_000_000_000_000n; // 1e18

const I128_MAX = (1n << 127n) - 1n;

/**
 * Computes (a * b) / c with arbitrary precision intermediate product and half-up rounding.
 *
 * @throws {Error} if c <= 0, arguments are negative, or result exceeds i128::MAX.
 */
export function mulDiv(a: bigint, b: bigint, c: bigint): bigint {
  if (c <= 0n || a < 0n || b < 0n) {
    throw new Error(`mulDiv overflow or invalid arguments: a=${a}, b=${b}, c=${c}`);
  }

  const product = a * b;
  const halfC = c / 2n;
  const roundedProduct = product + halfC;
  const quotient = roundedProduct / c;

  if (quotient > I128_MAX) {
    throw new Error(`mulDiv result exceeds i128 range: ${quotient}`);
  }

  return quotient;
}

/**
 * Calculates owed amount given principal and current vs origination borrow indices.
 */
export function calculateOwedFromIndex(
  principal: bigint,
  currentIndex: bigint,
  originIndex: bigint = INDEX_SCALE,
): bigint {
  if (principal <= 0n) return 0n;
  return mulDiv(principal, currentIndex, originIndex);
}
