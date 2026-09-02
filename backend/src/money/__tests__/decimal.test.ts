import {
  roundDiv,
  toStroops,
  fromStroops,
  splitProRata,
  roundToCents,
  RoundingMode,
  MoneyError,
  STROOP_SCALE,
  STROOP_DECIMALS,
} from '../decimal.js';

describe('roundDiv', () => {
  it('floors toward negative infinity', () => {
    expect(roundDiv(7n, 2n, RoundingMode.Floor)).toBe(3n);
    expect(roundDiv(-7n, 2n, RoundingMode.Floor)).toBe(-4n);
    expect(roundDiv(6n, 2n, RoundingMode.Floor)).toBe(3n);
  });

  it('ceils toward positive infinity', () => {
    expect(roundDiv(7n, 2n, RoundingMode.Ceil)).toBe(4n);
    expect(roundDiv(-7n, 2n, RoundingMode.Ceil)).toBe(-3n);
    expect(roundDiv(6n, 2n, RoundingMode.Ceil)).toBe(3n);
  });

  it('rounds half away from zero for HalfUp', () => {
    expect(roundDiv(5n, 2n, RoundingMode.HalfUp)).toBe(3n); // 2.5 -> 3
    expect(roundDiv(-5n, 2n, RoundingMode.HalfUp)).toBe(-3n);
    expect(roundDiv(7n, 2n, RoundingMode.HalfUp)).toBe(4n); // 3.5 -> 4
    expect(roundDiv(1n, 4n, RoundingMode.HalfUp)).toBe(0n); // 0.25 -> 0
  });

  it("rounds half to even for HalfEven (banker's rounding)", () => {
    expect(roundDiv(5n, 2n, RoundingMode.HalfEven)).toBe(2n); // 2.5 -> 2 (even)
    expect(roundDiv(7n, 2n, RoundingMode.HalfEven)).toBe(4n); // 3.5 -> 4 (even)
    expect(roundDiv(9n, 2n, RoundingMode.HalfEven)).toBe(4n); // 4.5 -> 4 (even)
    expect(roundDiv(3n, 2n, RoundingMode.HalfEven)).toBe(2n); // 1.5 -> 2 (even)
    expect(roundDiv(-5n, 2n, RoundingMode.HalfEven)).toBe(-2n);
  });

  it('throws MoneyError on division by zero', () => {
    expect(() => roundDiv(5n, 0n, RoundingMode.HalfEven)).toThrow(MoneyError);
  });

  it('returns the exact quotient when there is no remainder', () => {
    expect(roundDiv(10n, 5n, RoundingMode.HalfEven)).toBe(2n);
  });

  // Bit-for-bit fixtures matching contracts/money/src/lib.rs's `round_div`
  // unit tests, so backend and contract agree on every rounding mode.
  it('matches the contract crate fixtures', () => {
    const cases: Array<[bigint, bigint, RoundingMode, bigint]> = [
      [7n, 2n, RoundingMode.Floor, 3n],
      [-7n, 2n, RoundingMode.Floor, -4n],
      [7n, 2n, RoundingMode.Ceil, 4n],
      [-7n, 2n, RoundingMode.Ceil, -3n],
      [5n, 2n, RoundingMode.HalfUp, 3n],
      [5n, 2n, RoundingMode.HalfEven, 2n],
      [7n, 2n, RoundingMode.HalfEven, 4n],
    ];
    for (const [num, den, mode, expected] of cases) {
      expect(roundDiv(num, den, mode)).toBe(expected);
    }
  });
});

describe('toStroops / fromStroops', () => {
  it('converts whole and fractional amounts', () => {
    expect(toStroops('1')).toBe(10_000_000n);
    expect(toStroops('1.5')).toBe(15_000_000n);
    expect(toStroops('0.0000001')).toBe(1n);
    expect(toStroops('-2.5')).toBe(-25_000_000n);
  });

  it('rounds excess precision using the policy mode instead of truncating', () => {
    // 1.00000005 has 8 fractional digits; half-even at the 8th digit with an
    // even 7th-digit predecessor (0) rounds down.
    expect(toStroops('1.00000005')).toBe(10_000_000n);
    // 1.00000015 ties against an odd predecessor (1) and rounds up to even (2).
    expect(toStroops('1.00000015')).toBe(10_000_002n);
  });

  it('rejects malformed input', () => {
    expect(() => toStroops('abc')).toThrow(MoneyError);
    expect(() => toStroops('1.2.3')).toThrow(MoneyError);
    expect(() => toStroops('')).toThrow(MoneyError);
  });

  it('round-trips through fromStroops at settlement precision', () => {
    for (const amount of ['0', '1', '1.5', '1234567.1234567', '-42.0000001']) {
      const stroops = toStroops(amount);
      const back = fromStroops(stroops);
      expect(toStroops(back)).toBe(stroops);
    }
  });

  it('formats zero and negative amounts correctly', () => {
    expect(fromStroops(0n)).toBe('0.0000000');
    expect(fromStroops(-1n)).toBe('-0.0000001');
    expect(fromStroops(STROOP_SCALE)).toBe('1.0000000');
  });

  it('exposes the expected policy constants', () => {
    expect(STROOP_SCALE).toBe(10_000_000n);
    expect(STROOP_DECIMALS).toBe(7);
  });
});

describe('splitProRata', () => {
  it('splits evenly divisible totals exactly', () => {
    expect(splitProRata(100n, [1n, 1n, 1n]).reduce((a, b) => a + b, 0n)).toBe(100n);
  });

  it('sums to the total even when it does not divide evenly, using largest remainder', () => {
    const cases: Array<[bigint, bigint[]]> = [
      [101n, [1n, 1n, 1n]],
      [1_000_000_007n, [3n, 5n, 7n, 11n]],
      [7n, [1n, 1n, 1n, 1n, 1n, 1n, 1n]],
      [0n, [1n, 2n, 3n]],
      [1n, [1n]],
      [10_000_000n, [333n, 333n, 334n]],
    ];
    for (const [total, weights] of cases) {
      const parts = splitProRata(total, weights);
      expect(parts.length).toBe(weights.length);
      expect(parts.reduce((a, b) => a + b, 0n)).toBe(total);
      for (const p of parts) {
        expect(p).toBeGreaterThanOrEqual(0n);
      }
    }
  });

  it('property: sums to total across many randomized cases with no drift', () => {
    // Deterministic LCG so failures are reproducible without adding a new
    // dependency to the backend for a single test file.
    let seed = 0x1378_1378 >>> 0;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed;
    };

    let cases = 0;
    for (let i = 0; i < 2000; i += 1) {
      const n = 1 + (next() % 10);
      const total = BigInt(next() % 1_000_000_000);
      const weights: bigint[] = [];
      for (let j = 0; j < n; j += 1) {
        weights.push(BigInt(next() % 1_000_000));
      }
      if (weights.every((w) => w === 0n)) continue; // ill-formed case, skip
      cases += 1;

      const parts = splitProRata(total, weights);
      expect(parts.reduce((a, b) => a + b, 0n)).toBe(total);
      for (const p of parts) {
        expect(p).toBeGreaterThanOrEqual(0n);
      }
    }
    expect(cases).toBeGreaterThan(1000);
  });

  it('rejects a nonzero total split across all-zero weights', () => {
    expect(() => splitProRata(100n, [0n, 0n, 0n])).toThrow(MoneyError);
    expect(splitProRata(0n, [0n, 0n, 0n])).toEqual([0n, 0n, 0n]);
  });

  it('rejects negative totals or weights', () => {
    expect(() => splitProRata(-1n, [1n])).toThrow(MoneyError);
    expect(() => splitProRata(1n, [-1n])).toThrow(MoneyError);
  });
});

describe('roundToCents', () => {
  it('rounds via half-even rounding mode (bankers rounding)', () => {
    expect(roundToCents(0.125)).toBe(0.12);
    expect(roundToCents(0.135)).toBe(0.14);
    expect(roundToCents(10.005)).toBe(10.0);
    expect(roundToCents(10.015)).toBe(10.02);
  });

  it('handles negative numbers symmetrically', () => {
    expect(roundToCents(-0.125)).toBe(-0.12);
    expect(roundToCents(-0.135)).toBe(-0.14);
  });
});
