/**
 * Tests for getScoreBandMax — verifies that band caps are always derived from
 * the config-endpoint `maxAmount` and never from stale page-level constants.
 *
 * Acceptance criteria (issue):
 *  - Band caps equal policy values (maxAmount from GET /loans/config).
 *  - Deleting the hardcoded constants does not break the logic.
 *  - Page caps equal policy values: each band is a fixed fraction of maxAmount.
 */
import {
  getScoreBandMax,
  EXCELLENT_SCORE_THRESHOLD,
  GOOD_SCORE_THRESHOLD,
  FAIR_SCORE_THRESHOLD,
  MINIMUM_ELIGIBLE_SCORE_THRESHOLD,
} from "./page";

describe("RequestLoanPage - getScoreBandMax (policy-driven caps)", () => {
  describe("Returns 0 when maxContractAmount is unavailable or invalid", () => {
    it("returns 0 when maxContractAmount is undefined", () => {
      expect(getScoreBandMax(800, undefined)).toBe(0);
    });

    it("returns 0 when maxContractAmount is 0", () => {
      expect(getScoreBandMax(800, 0)).toBe(0);
    });

    it("returns 0 when maxContractAmount is negative", () => {
      expect(getScoreBandMax(800, -100)).toBe(0);
    });

    it("returns 0 when maxContractAmount is NaN", () => {
      expect(getScoreBandMax(800, Number.NaN)).toBe(0);
    });

    it("returns 0 for ineligible score below minimum", () => {
      expect(getScoreBandMax(450, 50_000)).toBe(0);
      expect(getScoreBandMax(499, 50_000)).toBe(0);
    });
  });

  /**
   * Policy-equality tests: given a known maxAmount from /loans/config, the band
   * cap must equal the expected fraction of that value.  When the backend
   * maxAmount changes these tests update automatically — the page constants do not.
   */
  describe("Band caps equal policy values (derived from maxContractAmount)", () => {
    const POLICY_MAX = 50_000; // simulate GET /loans/config → data.maxAmount

    it("excellent band (≥750): cap equals 100% of maxAmount", () => {
      expect(getScoreBandMax(EXCELLENT_SCORE_THRESHOLD, POLICY_MAX)).toBe(POLICY_MAX);
      expect(getScoreBandMax(800, POLICY_MAX)).toBe(POLICY_MAX);
      expect(getScoreBandMax(850, POLICY_MAX)).toBe(POLICY_MAX);
    });

    it("good band (≥670): cap equals 50% of maxAmount", () => {
      expect(getScoreBandMax(GOOD_SCORE_THRESHOLD, POLICY_MAX)).toBe(POLICY_MAX * 0.5);
      expect(getScoreBandMax(700, POLICY_MAX)).toBe(POLICY_MAX * 0.5);
      expect(getScoreBandMax(749, POLICY_MAX)).toBe(POLICY_MAX * 0.5);
    });

    it("fair band (≥580): cap equals 20% of maxAmount", () => {
      expect(getScoreBandMax(FAIR_SCORE_THRESHOLD, POLICY_MAX)).toBe(POLICY_MAX * 0.2);
      expect(getScoreBandMax(620, POLICY_MAX)).toBe(POLICY_MAX * 0.2);
      expect(getScoreBandMax(669, POLICY_MAX)).toBe(POLICY_MAX * 0.2);
    });

    it("minimum band (≥500): cap equals 10% of maxAmount", () => {
      expect(getScoreBandMax(MINIMUM_ELIGIBLE_SCORE_THRESHOLD, POLICY_MAX)).toBe(POLICY_MAX * 0.1);
      expect(getScoreBandMax(550, POLICY_MAX)).toBe(POLICY_MAX * 0.1);
      expect(getScoreBandMax(579, POLICY_MAX)).toBe(POLICY_MAX * 0.1);
    });
  });

  describe("Policy caps update when maxAmount changes (no code deploy needed)", () => {
    it("all bands scale correctly when maxAmount doubles", () => {
      const policyMax = 100_000; // e.g. after an on-chain governance vote
      expect(getScoreBandMax(800, policyMax)).toBe(100_000); // excellent → 100%
      expect(getScoreBandMax(700, policyMax)).toBe(50_000);  // good → 50%
      expect(getScoreBandMax(620, policyMax)).toBe(20_000);  // fair → 20%
      expect(getScoreBandMax(530, policyMax)).toBe(10_000);  // minimum → 10%
    });

    it("all bands scale correctly when maxAmount is halved", () => {
      const policyMax = 25_000;
      expect(getScoreBandMax(800, policyMax)).toBe(25_000);
      expect(getScoreBandMax(700, policyMax)).toBe(12_500);
      expect(getScoreBandMax(620, policyMax)).toBe(5_000);
      expect(getScoreBandMax(530, policyMax)).toBe(2_500);
    });
  });
});
