import { formatCurrency, formatCurrencyNoSymbol } from "./loanFormatters";

describe("formatCurrency — locale-aware formatting", () => {
  it("formats USD amounts for en locale with grouping", () => {
    expect(formatCurrency(1234.56, "en")).toBe("$1,234.56");
  });

  it("formats USD amounts for es locale with grouping", () => {
    // es uses period for thousands separator
    expect(formatCurrency(1234.56, "es")).toBe("$1.234,56");
  });

  it("formats USD amounts for tl locale with grouping", () => {
    expect(formatCurrency(1234.56, "tl")).toBe("$1,234.56");
  });

  it("respects DISPLAY_DP (2 decimal places) by default", () => {
    // 7 stroop-precision digits internally, truncated to 2 dp for display
    expect(formatCurrency(12.5, "en")).toBe("$12.50");
    expect(formatCurrency(12.567, "en")).toBe("$12.57"); // half-even rounding
  });

  it("handles zero", () => {
    expect(formatCurrency(0, "en")).toBe("$0.00");
  });

  it("handles negative amounts", () => {
    expect(formatCurrency(-12.5, "en")).toBe("-$12.50");
  });

  it("supports custom decimalPlaces", () => {
    expect(formatCurrency(12.5, "en", { decimalPlaces: 0 })).toBe("$13");
    expect(formatCurrency(12.5, "en", { decimalPlaces: 4 })).toBe("$12.5000");
  });
});

describe("formatCurrencyNoSymbol — no leading $", () => {
  it("strips the dollar sign for en", () => {
    expect(formatCurrencyNoSymbol(1234.56, "en")).toBe("1,234.56");
  });

  it("strips the dollar sign for es", () => {
    expect(formatCurrencyNoSymbol(1234.56, "es")).toBe("1.234,56");
  });

  it("strips the dollar sign for negative amounts", () => {
    expect(formatCurrencyNoSymbol(-12.5, "en")).toBe("-12.50");
  });
});

describe("formatCurrency — locale snapshot parity", () => {
  const testCases = [
    { amount: 0, en: "$0.00", es: "$0,00", tl: "$0.00" },
    { amount: 12.34, en: "$12.34", es: "$12,34", tl: "$12.34" },
    { amount: 1234.56, en: "$1,234.56", es: "$1.234,56", tl: "$1,234.56" },
    { amount: 999999.99, en: "$999,999.99", es: "$999.999,99", tl: "$999,999.99" },
    { amount: 0.01, en: "$0.01", es: "$0,01", tl: "$0.01" },
  ];

  for (const { amount, en, es, tl } of testCases) {
    it(`snapshot: ${amount} across locales`, () => {
      expect(formatCurrency(amount, "en")).toBe(en);
      expect(formatCurrency(amount, "es")).toBe(es);
      expect(formatCurrency(amount, "tl")).toBe(tl);
    });
  }
});
