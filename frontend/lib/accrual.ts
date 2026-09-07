/**
 * Fixed-point mathematical operations for loan interest index calculation (issue #1382).
 * Shared across contracts, backend, and frontend with bit-for-bit parity.
 */

export const INDEX_SCALE: bigint = BigInt(
  process.env.NEXT_PUBLIC_INDEX_SCALE || "1000000000000000000",
); // 1e18

export const LEDGER_INTERVAL_SECONDS: number = Number(
  process.env.NEXT_PUBLIC_LEDGER_INTERVAL_SECONDS || "5",
);

const I128_MAX: bigint = (BigInt(1) << BigInt(127)) - BigInt(1);

/**
 * Computes (a * b) / c with 256-bit widened intermediate product and half-up rounding.
 *
 * @throws {Error} if c <= 0, arguments are negative, or result exceeds i128 range.
 */
export function mulDiv(a: bigint, b: bigint, c: bigint): bigint {
  if (c <= BigInt(0) || a < BigInt(0) || b < BigInt(0)) {
    throw new Error(`mulDiv overflow or invalid arguments: a=${a}, b=${b}, c=${c}`);
  }

  const product = a * b;
  const halfC = c / BigInt(2);
  const roundedProduct = product + halfC;
  const quotient = roundedProduct / c;

  if (quotient > I128_MAX) {
    throw new Error(`mulDiv result exceeds i128 range: ${quotient}`);
  }

  return quotient;
}

/**
 * Projects owed amount forward from the last indexed snapshot by extrapolating unsettled ledgers.
 * Invariant: repayments must use the backend-settled owed, never the projected component.
 */
export function projectOwed(
  principal: bigint,
  originIndex: bigint,
  lastIndexedIndex: bigint,
  unsettledLedgers: number,
  ratePerLedgerScaled: bigint,
): { projectedOwed: bigint; unsettledInterest: bigint } {
  let currentIndex = lastIndexedIndex;
  for (let i = 0; i < unsettledLedgers; i++) {
    currentIndex = mulDiv(currentIndex, INDEX_SCALE + ratePerLedgerScaled, INDEX_SCALE);
  }
  const settledOwed = mulDiv(principal, lastIndexedIndex, originIndex);
  const projectedOwed = mulDiv(principal, currentIndex, originIndex);
  const unsettledInterest = projectedOwed > settledOwed ? projectedOwed - settledOwed : BigInt(0);
  return { projectedOwed, unsettledInterest };
}
