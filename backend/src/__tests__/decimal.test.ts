import {
  RoundingMode,
  roundDiv,
  toStroops,
  fromStroops,
  splitProRata,
  STROOP_SCALE,
  MoneyError,
} from '../money/decimal.js';

describe('money/decimal roundDiv', () => {
  // These fixtures are transcribed 1:1 from `contracts/money/src/lib.rs`'s
  // `round_div_*` unit tests so the two implementations are verified against
  // the exact same table, not just "similar" behavior.
  it('floor', () => {
    expect(roundDiv(7n, 2n, RoundingMode.Floor)).toBe(3n);
    expect(roundDiv(-7n, 2n, RoundingMode.Floor)).toBe(-4n);
    expect(roundDiv(6n, 2n, RoundingMode.Floor)).toBe(3n);
  });

  it('ceil', () => {
    expect(roundDiv(7n, 2n, RoundingMode.Ceil)).toBe(4n);
    expect(roundDiv(-7n, 2n, RoundingMode.Ceil)).toBe(-3n);
    expect(roundDiv(6n, 2n, RoundingMode.Ceil)).toBe(3n);
  });

  it('half up', () => {
    expect(roundDiv(5n, 2n, RoundingMode.HalfUp)).toBe(3n); // 2.5 -> 3
    expect(roundDiv(-5n, 2n, RoundingMode.HalfUp)).toBe(-3n);
    expect(roundDiv(7n, 2n, RoundingMode.HalfUp)).toBe(4n); // 3.5 -> 4
    expect(roundDiv(1n, 4n, RoundingMode.HalfUp)).toBe(0n); // 0.25 -> 0
  });

  it("half even (banker's rounding)", () => {
    expect(roundDiv(5n, 2n, RoundingMode.HalfEven)).toBe(2n); // 2.5 -> 2 (even)
    expect(roundDiv(7n, 2n, RoundingMode.HalfEven)).toBe(4n); // 3.5 -> 4 (even)
    expect(roundDiv(9n, 2n, RoundingMode.HalfEven)).toBe(4n); // 4.5 -> 4 (even)
    expect(roundDiv(3n, 2n, RoundingMode.HalfEven)).toBe(2n); // 1.5 -> 2 (even)
    expect(roundDiv(-5n, 2n, RoundingMode.HalfEven)).toBe(-2n);
  });

  it('throws on division by zero', () => {
    expect(() => roundDiv(5n, 0n, RoundingMode.HalfEven)).toThrow(MoneyError);
  });
});

describe('money/decimal toStroops / fromStroops round trip', () => {
  it('converts whole and fractional amounts at full stroop precision', () => {
    expect(toStroops('1')).toBe(10_000_000n);
    expect(toStroops('0.0000001')).toBe(1n);
    expect(toStroops('12.5')).toBe(125_000_000n);
    expect(toStroops('-3.1400000')).toBe(-31_400_000n);
  });

  it('fromStroops is the exact inverse of toStroops at settlement precision', () => {
    const cases = ['0', '1', '0.0000001', '12.5000000', '9999999.9999999', '-42.4200000'];
    for (const c of cases) {
      const stroops = toStroops(c);
      expect(toStroops(fromStroops(stroops))).toBe(stroops);
    }
  });

  it('rounds excess precision using the configured mode rather than truncating', () => {
    // 0.00000015 has 8 fractional digits (one more than STROOP_DECIMALS);
    // half-even on the last digit rounds 1.5 -> 2.
    expect(toStroops('0.00000015', RoundingMode.HalfEven)).toBe(2n);
    expect(toStroops('0.00000025', RoundingMode.HalfEven)).toBe(2n);
  });

  it('rejects malformed input', () => {
    expect(() => toStroops('abc')).toThrow(MoneyError);
    expect(() => toStroops('')).toThrow(MoneyError);
  });
});

describe('money/decimal splitProRata', () => {
  it('sums exactly to the total for representative cases', () => {
    const cases: Array<[bigint, bigint[]]> = [
      [100n, [1n, 1n, 1n]],
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
    }
  });

  it('randomized property test: parts always sum exactly to the total', () => {
    // Deterministic xorshift32 PRNG (no external dependency) seeded so the
    // run is reproducible; report this seed/case count in the PR.
    let state = 0x1378_1378 >>> 0;
    const seed = state;
    const next = (): number => {
      state ^= state << 13;
      state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return state;
    };

    const CASE_COUNT = 5_000;
    for (let i = 0; i < CASE_COUNT; i += 1) {
      const n = 1 + (next() % 12);
      const total = BigInt(next() % 1_000_000_000);
      const weights: bigint[] = [];
      for (let j = 0; j < n; j += 1) {
        weights.push(BigInt(next() % 1_000_000));
      }
      if (weights.every((w) => w === 0n)) {
        continue;
      }
      const parts = splitProRata(total, weights);
      const sum = parts.reduce((a, b) => a + b, 0n);
      expect(sum).toBe(total);
      for (const p of parts) {
        expect(p >= 0n).toBe(true);
      }
    }
    // Recorded for the PR description: seed 0x13781378, 5000 cases.
    expect(seed).toBe(0x1378_1378);
  });

  it('throws when a nonzero total cannot be allocated (all weights zero)', () => {
    expect(() => splitProRata(100n, [0n, 0n, 0n])).toThrow(MoneyError);
    expect(splitProRata(0n, [0n, 0n, 0n])).toEqual([0n, 0n, 0n]);
  });
});

describe('money/decimal STROOP_SCALE', () => {
  it('matches the policy (10^7)', () => {
    expect(STROOP_SCALE).toBe(10_000_000n);
  });
});
