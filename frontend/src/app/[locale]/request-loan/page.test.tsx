import {
  getScoreBandMax,
  EXCELLENT_SCORE_MAX_LOAN,
  GOOD_SCORE_MAX_LOAN,
  FAIR_SCORE_MAX_LOAN,
  MINIMUM_SCORE_MAX_LOAN,
  DEFAULT_ONCHAIN_MAX_LOAN_AMOUNT,
} from "./page";

describe("RequestLoanPage - getScoreBandMax limit clamping", () => {
  describe("Default score tier limits without contract override", () => {
    it("returns 0 for ineligible score below minimum (< 500)", () => {
      expect(getScoreBandMax(450)).toBe(0);
      expect(getScoreBandMax(499)).toBe(0);
    });

    it("returns 5,000 for minimum eligible score band (500 - 579)", () => {
      expect(getScoreBandMax(500)).toBe(MINIMUM_SCORE_MAX_LOAN);
      expect(getScoreBandMax(550)).toBe(MINIMUM_SCORE_MAX_LOAN);
      expect(getScoreBandMax(579)).toBe(MINIMUM_SCORE_MAX_LOAN);
    });

    it("returns 10,000 for fair score band (580 - 669)", () => {
      expect(getScoreBandMax(580)).toBe(FAIR_SCORE_MAX_LOAN);
      expect(getScoreBandMax(620)).toBe(FAIR_SCORE_MAX_LOAN);
      expect(getScoreBandMax(669)).toBe(FAIR_SCORE_MAX_LOAN);
    });

    it("returns 25,000 for good score band (670 - 749)", () => {
      expect(getScoreBandMax(670)).toBe(GOOD_SCORE_MAX_LOAN);
      expect(getScoreBandMax(700)).toBe(GOOD_SCORE_MAX_LOAN);
      expect(getScoreBandMax(749)).toBe(GOOD_SCORE_MAX_LOAN);
    });

    it("returns 50,000 for excellent score band (>= 750)", () => {
      expect(getScoreBandMax(750)).toBe(EXCELLENT_SCORE_MAX_LOAN);
      expect(getScoreBandMax(800)).toBe(EXCELLENT_SCORE_MAX_LOAN);
      expect(getScoreBandMax(850)).toBe(EXCELLENT_SCORE_MAX_LOAN);
    });
  });

  describe("Contract maxAmount clamping", () => {
    it("clamps excellent score (advertised 50k) to contract limit (e.g. 5,000)", () => {
      const contractLimit = 5_000;
      expect(getScoreBandMax(800, contractLimit)).toBe(5_000);
      expect(getScoreBandMax(750, contractLimit)).toBe(5_000);
    });

    it("clamps good score (advertised 25k) to contract limit when limit is lower", () => {
      const contractLimit = 15_000;
      expect(getScoreBandMax(700, contractLimit)).toBe(15_000);
      expect(getScoreBandMax(800, contractLimit)).toBe(15_000);
    });

    it("does not increase score band limit if contract limit is higher", () => {
      const contractLimit = 100_000;
      // Fair score max is 10,000 even if contract allows up to 100,000
      expect(getScoreBandMax(600, contractLimit)).toBe(10_000);
      // Good score max is 25,000
      expect(getScoreBandMax(700, contractLimit)).toBe(25_000);
      // Excellent score max is 50,000
      expect(getScoreBandMax(800, contractLimit)).toBe(50_000);
    });

    it("falls back to DEFAULT_ONCHAIN_MAX_LOAN_AMOUNT when contract limit is undefined or invalid", () => {
      expect(getScoreBandMax(800, undefined)).toBe(DEFAULT_ONCHAIN_MAX_LOAN_AMOUNT);
      expect(getScoreBandMax(800, 0)).toBe(DEFAULT_ONCHAIN_MAX_LOAN_AMOUNT);
      expect(getScoreBandMax(800, -100)).toBe(DEFAULT_ONCHAIN_MAX_LOAN_AMOUNT);
      expect(getScoreBandMax(800, Number.NaN)).toBe(DEFAULT_ONCHAIN_MAX_LOAN_AMOUNT);
    });
  });
});
