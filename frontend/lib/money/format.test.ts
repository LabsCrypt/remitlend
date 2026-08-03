import {
  roundDiv,
  formatStroops,
  parseAmount,
  RoundingMode,
  MoneyError,
  STROOP_SCALE,
  STROOP_DECIMALS,
} from "./format";

// `tsc` rejects BigInt literal syntax (`0n`) below ES2020, and this
// frontend's tsconfig.json targets ES2017 — see format.ts's header comment.
const b = (n: number): bigint => BigInt(n);

describe("roundDiv", () => {
  it("matches the contract crate fixtures for every rounding mode", () => {
    expect(roundDiv(b(7), b(2), RoundingMode.Floor)).toBe(b(3));
    expect(roundDiv(b(-7), b(2), RoundingMode.Floor)).toBe(b(-4));
    expect(roundDiv(b(7), b(2), RoundingMode.Ceil)).toBe(b(4));
    expect(roundDiv(b(-7), b(2), RoundingMode.Ceil)).toBe(b(-3));
    expect(roundDiv(b(5), b(2), RoundingMode.HalfUp)).toBe(b(3));
    expect(roundDiv(b(5), b(2), RoundingMode.HalfEven)).toBe(b(2));
    expect(roundDiv(b(7), b(2), RoundingMode.HalfEven)).toBe(b(4));
  });

  it("throws on division by zero", () => {
    expect(() => roundDiv(b(1), b(0), RoundingMode.HalfEven)).toThrow(MoneyError);
  });
});

describe("formatStroops", () => {
  it("formats at the default display precision (2dp, half-even)", () => {
    expect(formatStroops(b(10_000_000))).toBe("1.00");
    expect(formatStroops(b(15_000_000))).toBe("1.50");
    expect(formatStroops(b(0))).toBe("0.00");
  });

  it("rounds half-even at the display boundary rather than truncating", () => {
    // 0.125 at 2dp: exact tie against an even predecessor (12) rounds down.
    expect(formatStroops(b(1_250_000), { decimalPlaces: 2 })).toBe("0.12");
    // 0.135 at 2dp: exact tie against an odd predecessor (13) rounds up.
    expect(formatStroops(b(1_350_000), { decimalPlaces: 2 })).toBe("0.14");
  });

  it("never rounds half-up against a half-even settlement value", () => {
    // The historical bug this policy fixes: Number(stroops)/1e7 then
    // toFixed(2) rounds half-up, but settlement is half-even. At full
    // precision these must agree.
    const stroops = b(1_250_000); // 0.125 exactly
    const halfEven = formatStroops(stroops, { decimalPlaces: 2, mode: RoundingMode.HalfEven });
    const halfUp = formatStroops(stroops, { decimalPlaces: 2, mode: RoundingMode.HalfUp });
    expect(halfEven).toBe("0.12");
    expect(halfUp).toBe("0.13");
    expect(halfEven).not.toBe(halfUp);
  });

  it("supports full settlement precision and zero decimal places", () => {
    expect(formatStroops(b(12_345_678), { decimalPlaces: STROOP_DECIMALS })).toBe("1.2345678");
    expect(formatStroops(b(12_345_678), { decimalPlaces: 0 })).toBe("1");
  });

  it("formats negative amounts with a single leading sign", () => {
    expect(formatStroops(b(-15_000_000))).toBe("-1.50");
    expect(formatStroops(b(-1_000), { decimalPlaces: 7 })).toBe("-0.0001000");
  });

  it("does not print a negative sign for a magnitude that rounds to zero", () => {
    expect(formatStroops(b(-1), { decimalPlaces: 2 })).toBe("0.00");
  });
});

describe("parseAmount", () => {
  it("parses whole and fractional amounts to exact stroops", () => {
    expect(parseAmount("1")).toBe(b(10_000_000));
    expect(parseAmount("1.5")).toBe(b(15_000_000));
    expect(parseAmount("0.0000001")).toBe(b(1));
  });

  it("strips thousands separators", () => {
    expect(parseAmount("1,234.5")).toBe(parseAmount("1234.5"));
  });

  it("rejects malformed input instead of silently coercing to zero", () => {
    expect(() => parseAmount("abc")).toThrow(MoneyError);
    expect(() => parseAmount("")).toThrow(MoneyError);
    expect(() => parseAmount("1.2.3")).toThrow(MoneyError);
  });

  it("round-trips settlement-precision amounts through formatStroops", () => {
    for (const amount of ["0", "1", "1234567.1234567", "0.0000001"]) {
      const stroops = parseAmount(amount);
      const displayed = formatStroops(stroops, { decimalPlaces: STROOP_DECIMALS });
      expect(parseAmount(displayed)).toBe(stroops);
    }
  });

  it("a truncated 2dp display value never re-parses to more precision than it shows", () => {
    const stroops = parseAmount("1.999999"); // sub-cent dust
    const displayed = formatStroops(stroops); // rounds to 2dp
    // 1.999999 rounds to 2.00 at 2dp — the *display* value equals the
    // settlement value here, demonstrating the invariant: formatStroops
    // never fabricates precision, and re-parsing the display string never
    // produces a value with fractional digits beyond what was shown.
    expect(parseAmount(displayed) % b(10_000)).toBe(b(0));
  });

  it("exposes the expected policy constants", () => {
    expect(STROOP_SCALE).toBe(b(10_000_000));
    expect(STROOP_DECIMALS).toBe(7);
  });
});
