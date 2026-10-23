import { describe, it, expect } from '@jest/globals';
import {
  accrueInterest,
  accrueWindowInterest,
  accrueWindows,
  parseStroopAmount,
  remainingPrincipal,
  splitRepayment,
} from '../loanAccrual.js';
import { RESIDUAL_SCALE } from '../fixedPoint.js';

/**
 * Windowed accrual replay (#1382).
 *
 * The loan manager settles an accrual window on every repayment. These tests
 * pin the off-chain replay to the contract's behaviour: the interest of a
 * window is charged on the principal that was outstanding during it, a
 * repayment is split across principal, interest and late fee, and the
 * sub-stroop remainder is carried into the next window.
 */

const PRINCIPAL = 10_000_000_000n; // 1_000 tokens in stroops
const RATE_BPS = 1200;
const TERM_LEDGERS = 17_280;
const APPROVED_LEDGER = 20;

describe('accrueWindowInterest', () => {
  it('matches the one-shot formula for a single window', () => {
    const window = accrueWindowInterest({
      principalStroops: PRINCIPAL,
      interestRateBps: RATE_BPS,
      elapsedLedgers: 4_320,
      termLedgers: TERM_LEDGERS,
      residual: 0n,
    });

    expect(window.interestStroops).toBe(
      accrueInterest({
        remainingPrincipalStroops: PRINCIPAL,
        interestRateBps: RATE_BPS,
        elapsedLedgers: 4_320,
        termLedgers: TERM_LEDGERS,
      }),
    );
  });

  it('carries the sub-stroop remainder into the next window', () => {
    // A principal that does not divide evenly produces a remainder.
    const first = accrueWindowInterest({
      principalStroops: 3n,
      interestRateBps: RATE_BPS,
      elapsedLedgers: 1,
      termLedgers: TERM_LEDGERS,
      residual: 0n,
    });

    expect(first.residual).toBeGreaterThan(0n);
    expect(first.residual).toBeLessThan(RESIDUAL_SCALE);

    const second = accrueWindowInterest({
      principalStroops: 3n,
      interestRateBps: RATE_BPS,
      elapsedLedgers: 1,
      termLedgers: TERM_LEDGERS,
      residual: first.residual,
    });

    // The carried remainder eventually flushes into a whole stroop.
    expect(second.interestStroops).toBeGreaterThanOrEqual(first.interestStroops);
    expect(second.residual).toBeLessThan(RESIDUAL_SCALE);
  });

  it('accrues nothing without a principal, a rate, a window or a term', () => {
    const base = {
      principalStroops: PRINCIPAL,
      interestRateBps: RATE_BPS,
      elapsedLedgers: 100,
      termLedgers: TERM_LEDGERS,
      residual: 7n,
    };

    expect(accrueWindowInterest({ ...base, principalStroops: 0n })).toEqual({
      interestStroops: 0n,
      residual: 7n,
    });
    expect(accrueWindowInterest({ ...base, interestRateBps: 0 })).toEqual({
      interestStroops: 0n,
      residual: 7n,
    });
    expect(accrueWindowInterest({ ...base, elapsedLedgers: 0 })).toEqual({
      interestStroops: 0n,
      residual: 7n,
    });
    expect(accrueWindowInterest({ ...base, termLedgers: 0 })).toEqual({
      interestStroops: 0n,
      residual: 7n,
    });
  });
});

describe('calendar boundary accrual inputs', () => {
  const elapsedLedgers = (start: string, end: string): number => {
    const elapsedDays = (Date.parse(end) - Date.parse(start)) / 86_400_000;
    return elapsedDays * TERM_LEDGERS;
  };

  it.each([
    [
      'leap day and February month end',
      '2024-02-28T00:00:00Z',
      '2024-03-01T00:00:00Z',
      2_400_000_000n,
    ],
    ['April month end', '2026-04-30T00:00:00Z', '2026-05-01T00:00:00Z', 1_200_000_000n],
  ])('accrues from elapsed ledgers across %s', (_boundary, start, end, expected) => {
    expect(
      accrueInterest({
        remainingPrincipalStroops: PRINCIPAL,
        interestRateBps: RATE_BPS,
        elapsedLedgers: elapsedLedgers(start, end),
        termLedgers: TERM_LEDGERS,
      }),
    ).toBe(expected);
  });

  it('preserves booked interest across a rate change and applies the new rate to the open window', () => {
    const accrual = accrueWindows({
      principalStroops: PRINCIPAL,
      interestRateBps: 1800,
      termLedgers: TERM_LEDGERS,
      approvedLedger: 0,
      settlements: [
        {
          ledger: 34_560,
          amountStroops: 0n,
          bookedInterestStroops: 2_400_000_000n,
        },
      ],
      currentLedger: 51_840,
    });

    expect(accrual.windowInterestStroops).toEqual([2_400_000_000n, 1_800_000_000n]);
    expect(accrual.outstandingInterestStroops).toBe(4_200_000_000n);
  });
});

describe('splitRepayment', () => {
  it('splits a repayment across principal, interest and late fee', () => {
    const [principal = 0n, interest = 0n, lateFee = 0n] = splitRepayment([600n, 300n, 100n], 500n);

    expect(principal + interest + lateFee).toBe(500n);
    expect(principal).toBe(300n);
    expect(interest).toBe(150n);
    expect(lateFee).toBe(50n);
  });

  it('never pays a bucket more than it is owed', () => {
    const [principal = 0n, interest = 0n] = splitRepayment([10n, 10n, 0n], 20n);

    expect(principal).toBe(10n);
    expect(interest).toBe(10n);
  });

  it('caps a repayment that exceeds the total debt', () => {
    const [principal = 0n, interest = 0n] = splitRepayment([10n, 10n, 0n], 1_000n);

    expect(principal).toBe(10n);
    expect(interest).toBe(10n);
  });

  it('allocates the leftover stroops by largest remainder', () => {
    const [principal = 0n, interest = 0n] = splitRepayment([1n, 1n, 0n], 1n);

    expect(principal + interest).toBe(1n);
  });
});

describe('accrueWindows', () => {
  it('reports the same interest as the one-shot formula without settlements', () => {
    const accrual = accrueWindows({
      principalStroops: PRINCIPAL,
      interestRateBps: RATE_BPS,
      termLedgers: TERM_LEDGERS,
      approvedLedger: APPROVED_LEDGER,
      settlements: [],
      currentLedger: APPROVED_LEDGER + 4_320,
    });

    expect(accrual.outstandingInterestStroops).toBe(
      accrueInterest({
        remainingPrincipalStroops: PRINCIPAL,
        interestRateBps: RATE_BPS,
        elapsedLedgers: 4_320,
        termLedgers: TERM_LEDGERS,
      }),
    );
    expect(accrual.remainingPrincipalStroops).toBe(PRINCIPAL);
    expect(accrual.windowInterestStroops).toHaveLength(1);
  });

  it('charges the second window on the remaining principal only', () => {
    const accrual = accrueWindows({
      principalStroops: PRINCIPAL,
      interestRateBps: RATE_BPS,
      termLedgers: TERM_LEDGERS,
      approvedLedger: APPROVED_LEDGER,
      settlements: [{ ledger: APPROVED_LEDGER + 4_320, amountStroops: 4_000_000_000n }],
      currentLedger: APPROVED_LEDGER + 8_640,
    });

    // The repayment is split between principal and interest, so the second
    // window is charged on less than the full principal.
    const firstWindow = accrueInterest({
      remainingPrincipalStroops: PRINCIPAL,
      interestRateBps: RATE_BPS,
      elapsedLedgers: 4_320,
      termLedgers: TERM_LEDGERS,
    });
    const secondWindow = accrueInterest({
      remainingPrincipalStroops: accrual.remainingPrincipalStroops,
      interestRateBps: RATE_BPS,
      elapsedLedgers: 4_320,
      termLedgers: TERM_LEDGERS,
    });

    expect(accrual.windowInterestStroops[0]).toBe(firstWindow);
    expect(accrual.windowInterestStroops[1]).toBe(secondWindow);
    expect(accrual.remainingPrincipalStroops).toBeLessThan(PRINCIPAL);
    expect(accrual.totalRepaidStroops).toBe(4_000_000_000n);
  });

  it('uses the interest the contract booked when it is available', () => {
    const accrual = accrueWindows({
      principalStroops: PRINCIPAL,
      interestRateBps: RATE_BPS,
      termLedgers: TERM_LEDGERS,
      approvedLedger: APPROVED_LEDGER,
      settlements: [
        {
          ledger: APPROVED_LEDGER + 4_320,
          amountStroops: 4_000_000_000n,
          bookedInterestStroops: 123_456n,
          residual: 42n,
        },
      ],
      currentLedger: APPROVED_LEDGER + 8_640,
    });

    expect(accrual.windowInterestStroops[0]).toBe(123_456n);
  });

  it('replays the settlements in ledger order', () => {
    const accrual = accrueWindows({
      principalStroops: PRINCIPAL,
      interestRateBps: RATE_BPS,
      termLedgers: TERM_LEDGERS,
      approvedLedger: APPROVED_LEDGER,
      settlements: [
        { ledger: APPROVED_LEDGER + 8_640, amountStroops: 1_000_000_000n },
        { ledger: APPROVED_LEDGER + 4_320, amountStroops: 1_000_000_000n },
      ],
      currentLedger: APPROVED_LEDGER + 8_640,
    });

    expect(accrual.lastSettledLedger).toBe(APPROVED_LEDGER + 8_640);
    expect(accrual.totalRepaidStroops).toBe(2_000_000_000n);
  });

  it('never reports a negative interest balance', () => {
    const accrual = accrueWindows({
      principalStroops: PRINCIPAL,
      interestRateBps: RATE_BPS,
      termLedgers: TERM_LEDGERS,
      approvedLedger: APPROVED_LEDGER,
      settlements: [{ ledger: APPROVED_LEDGER + 100, amountStroops: PRINCIPAL }],
      currentLedger: APPROVED_LEDGER + 8_640,
    });

    expect(accrual.outstandingInterestStroops).toBeGreaterThanOrEqual(0n);
    expect(accrual.remainingPrincipalStroops).toBeGreaterThanOrEqual(0n);
  });
});

describe('parseStroopAmount', () => {
  it('accepts an integer stroop count with a zero fraction', () => {
    expect(parseStroopAmount('150')).toBe(150n);
    expect(parseStroopAmount('150.0')).toBe(150n);
    expect(parseStroopAmount(null)).toBe(0n);
  });

  it('rejects a fractional stroop amount', () => {
    expect(() => parseStroopAmount('150.5')).toThrow();
  });
});

describe('remainingPrincipal', () => {
  it('floors at zero once the loan is repaid', () => {
    expect(remainingPrincipal(100n, 40n)).toBe(60n);
    expect(remainingPrincipal(100n, 140n)).toBe(0n);
  });
});
