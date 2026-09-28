import {
  formatAmountOnBlur,
  getAssetDecimals,
  getPrecisionError,
  hasInvalidPrecision,
  sanitizeAmountInput,
  toStroops,
} from "./amount";

describe("amount utils", () => {
  describe("getAssetDecimals", () => {
    it("returns known asset decimals", () => {
      expect(getAssetDecimals("XLM")).toBe(7);
      expect(getAssetDecimals("USDC")).toBe(2);
      expect(getAssetDecimals("EURC")).toBe(2);
      expect(getAssetDecimals("PHP")).toBe(2);
    });

    it("falls back for unknown assets", () => {
      expect(getAssetDecimals("UNKNOWN")).toBe(7);
    });
  });

  describe("toStroops", () => {
    it("converts whole and fractional amounts", () => {
      expect(toStroops("1", 7)?.toString()).toBe("10000000");
      expect(toStroops("1.5", 7)?.toString()).toBe("15000000");
      expect(toStroops("0.01", 2)?.toString()).toBe("1");
      expect(toStroops("12.34", 2)?.toString()).toBe("1234");
    });

    it("returns null when precision exceeds decimals", () => {
      expect(toStroops("1.234", 2)).toBeNull();
      expect(toStroops("0.00000001", 7)).toBeNull();
    });
  });

  describe("hasInvalidPrecision / getPrecisionError", () => {
    it("treats values at the limit as valid", () => {
      expect(hasInvalidPrecision("1.12", 2)).toBe(false);
      expect(getPrecisionError("1.12", "USDC")).toBeNull();
    });

    it("flags values over the limit and returns error text", () => {
      expect(hasInvalidPrecision("1.123", 2)).toBe(true);
      expect(getPrecisionError("1.123", "USDC")).toBe("USDC supports at most 2 decimal places.");
    });
  });

  describe("sanitizeAmountInput", () => {
    it("strips non-numeric and collapses multiple dots", () => {
      expect(sanitizeAmountInput("$1,234.56")).toBe("1234.56");
      expect(sanitizeAmountInput("1.2.3")).toBe("1.23");
      expect(sanitizeAmountInput("..1..2..3..")).toBe(".123");
    });
  });

  describe("formatAmountOnBlur", () => {
    it("returns empty string for empty, whitespace, or non-numeric inputs", () => {
      expect(formatAmountOnBlur("")).toBe("");
      expect(formatAmountOnBlur("   ")).toBe("");
      expect(formatAmountOnBlur(".")).toBe("");
      expect(formatAmountOnBlur("abc")).toBe("");
    });

    it("formats valid amounts using exact decimal precision", () => {
      expect(formatAmountOnBlur("10", "USDC")).toBe("10.00");
      expect(formatAmountOnBlur("10.5", "USDC")).toBe("10.50");
      expect(formatAmountOnBlur("0.1", "USDC")).toBe("0.10");
      expect(formatAmountOnBlur("1", "XLM")).toBe("1.0000000");
      expect(formatAmountOnBlur("1.5", "XLM")).toBe("1.5000000");
    });

    it("preserves over-precision values without silent float rounding", () => {
      // For a 2-decimal asset like USDC, 3 decimals should not be silently rounded
      expect(formatAmountOnBlur("10.005", "USDC")).toBe("10.005");
      expect(formatAmountOnBlur("1.005", "USDC")).toBe("1.005");
      expect(formatAmountOnBlur("10.12345", "USDC")).toBe("10.12345");

      // For 7-decimal XLM, 8 decimals should be preserved as-is
      expect(formatAmountOnBlur("1.12345678", "XLM")).toBe("1.12345678");
    });

    it("allows getPrecisionError to detect invalid precision on the preserved value", () => {
      const blurredUsdc = formatAmountOnBlur("10.005", "USDC");
      expect(blurredUsdc).toBe("10.005");
      expect(getPrecisionError(blurredUsdc, "USDC")).toBe(
        "USDC supports at most 2 decimal places.",
      );

      const blurredXlm = formatAmountOnBlur("0.12345678", "XLM");
      expect(blurredXlm).toBe("0.12345678");
      expect(getPrecisionError(blurredXlm, "XLM")).toBe("XLM supports at most 7 decimal places.");
    });
  });
});
