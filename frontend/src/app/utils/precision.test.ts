import { getAssetPrecision, truncateDecimals } from "./precision";

describe("precision utils", () => {
  describe("truncateDecimals", () => {
    it("truncates to exactly the requested decimal count", () => {
      expect(truncateDecimals("12.345", 2)).toBe("12.34");
      expect(truncateDecimals("0.12345678", 7)).toBe("0.1234567");
    });

    it("supports zero-decimal truncation", () => {
      expect(truncateDecimals("42.9", 0)).toBe("42.");
    });

    it("keeps only the first decimal segment when multiple points are typed", () => {
      expect(truncateDecimals("1.234.56", 2)).toBe("1.23");
    });
  });

  describe("getAssetPrecision", () => {
    it("returns configured asset precisions", () => {
      expect(getAssetPrecision("XLM")).toBe(7);
      expect(getAssetPrecision("USDC")).toBe(2);
    });
  });
});