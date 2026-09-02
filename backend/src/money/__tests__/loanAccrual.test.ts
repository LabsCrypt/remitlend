import { parseStroopAmount, remainingPrincipal, accrueInterest } from '../loanAccrual.js';
import { MoneyError } from '../decimal.js';

describe('parseStroopAmount', () => {
  it('parses an integer stroop count', () => {
    expect(parseStroopAmount('10000000000')).toBe(10000000000n);
    expect(parseStroopAmount('0')).toBe(0n);
  });

  it('accepts an all-zero fractional part (Postgres NUMERIC formatting)', () => {
    expect(parseStroopAmount('150.0')).toBe(150n);
  });

  it('treats missing values as zero', () => {
    expect(parseStroopAmount(null)).toBe(0n);
    expect(parseStroopAmount(undefined)).toBe(0n);
    expect(parseStroopAmount('')).toBe(0n);
  });

  it('rejects a genuinely fractional stroop amount', () => {
    expect(() => parseStroopAmount('150.5')).toThrow(MoneyError);
  });
});

describe('remainingPrincipal', () => {
  it('subtracts repaid amounts from principal', () => {
    expect(remainingPrincipal(1000n, 400n)).toBe(600n);
  });

  it('floors at zero once the loan is fully repaid', () => {
    expect(remainingPrincipal(1000n, 1000n)).toBe(0n);
    expect(remainingPrincipal(1000n, 1500n)).toBe(0n);
  });
});

describe('accrueInterest', () => {
  const RATE_BPS = 1200; // 12%
  const TERM_LEDGERS = 17280; // 1 day in ledgers

  it('accrues simple interest on the remaining principal', () => {
    // 1000 XLM (1e10 stroops) * 12% * 5 ledgers / (1 day term in ledgers)
    expect(
      accrueInterest({
        remainingPrincipalStroops: 10000000000n,
        interestRateBps: RATE_BPS,
        elapsedLedgers: 5,
        termLedgers: TERM_LEDGERS,
      }),
    ).toBe(347222n);
  });

  it('accrues less interest on a partially repaid principal (issue #1600)', () => {
    const fullPrincipal = accrueInterest({
      remainingPrincipalStroops: 10000000000n,
      interestRateBps: RATE_BPS,
      elapsedLedgers: 5,
      termLedgers: TERM_LEDGERS,
    });
    const halfPrincipal = accrueInterest({
      remainingPrincipalStroops: 5000000000n,
      interestRateBps: RATE_BPS,
      elapsedLedgers: 5,
      termLedgers: TERM_LEDGERS,
    });
    expect(halfPrincipal).toBe(173611n);
    expect(halfPrincipal).toBeLessThan(fullPrincipal);
  });

  it('returns zero for a fully repaid (zero remaining) loan', () => {
    expect(
      accrueInterest({
        remainingPrincipalStroops: 0n,
        interestRateBps: RATE_BPS,
        elapsedLedgers: 5,
        termLedgers: TERM_LEDGERS,
      }),
    ).toBe(0n);
  });

  it('returns zero when no time has elapsed', () => {
    expect(
      accrueInterest({
        remainingPrincipalStroops: 10000000000n,
        interestRateBps: RATE_BPS,
        elapsedLedgers: 0,
        termLedgers: TERM_LEDGERS,
      }),
    ).toBe(0n);
  });

  it('returns zero for a zero interest rate', () => {
    expect(
      accrueInterest({
        remainingPrincipalStroops: 10000000000n,
        interestRateBps: 0,
        elapsedLedgers: 5,
        termLedgers: TERM_LEDGERS,
      }),
    ).toBe(0n);
  });
});
