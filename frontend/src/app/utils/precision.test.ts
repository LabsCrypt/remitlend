import { truncateDecimals, getAssetPrecision } from "./precision";

describe("truncateDecimals (#1304)", () => {
  it("keeps exactly N decimals when the input has more", () => {
    // Off-by-one bug: used slice(0, decimals + 1) instead of slice(0, decimals).
    expect(truncateDecimals("1.12345", 2)).toBe("1.12");
    expect(truncateDecimals("9.9999999", 7)).toBe("9.9999999");
    expect(truncateDecimals("0.123456789", 7)).toBe("0.1234567");
  });

  it("does not modify values already within precision", () => {
    expect(truncateDecimals("1.5", 7)).toBe("1.5");
    expect(truncateDecimals("1.12", 2)).toBe("1.12");
    expect(truncateDecimals("42", 7)).toBe("42");
  });

  it("handles an empty string", () => {
    expect(truncateDecimals("", 7)).toBe("");
  });

  it("handles multiple decimal points by keeping only the first fractional part", () => {
    expect(truncateDecimals("1.2.3", 2)).toBe("1.2");
    expect(truncateDecimals("1.234.5", 1)).toBe("1.2");
  });
});

describe("getAssetPrecision", () => {
  it("returns 7 for XLM", () => {
    expect(getAssetPrecision("XLM")).toBe(7);
  });

  it("returns 2 for stablecoins", () => {
    expect(getAssetPrecision("USDC")).toBe(2);
    expect(getAssetPrecision("EURC")).toBe(2);
    expect(getAssetPrecision("PHP")).toBe(2);
  });

  it("is case-insensitive", () => {
    expect(getAssetPrecision("xlm")).toBe(7);
    expect(getAssetPrecision("usdc")).toBe(2);
  });

  it("falls back to 7 for unknown assets", () => {
    expect(getAssetPrecision("UNKNOWN")).toBe(7);
  });
});
