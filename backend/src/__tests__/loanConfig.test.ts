import { validateLoanConfig } from "../config/loanConfig.js";

describe("Loan config startup validation", () => {
  const originalEnv = {
    LOAN_MIN_SCORE: process.env.LOAN_MIN_SCORE,
    LOAN_MAX_AMOUNT: process.env.LOAN_MAX_AMOUNT,
    LOAN_INTEREST_RATE_PERCENT: process.env.LOAN_INTEREST_RATE_PERCENT,
    CREDIT_SCORE_THRESHOLD: process.env.CREDIT_SCORE_THRESHOLD,
  };

  afterEach(() => {
    process.env.LOAN_MIN_SCORE = originalEnv.LOAN_MIN_SCORE;
    process.env.LOAN_MAX_AMOUNT = originalEnv.LOAN_MAX_AMOUNT;
    process.env.LOAN_INTEREST_RATE_PERCENT = originalEnv.LOAN_INTEREST_RATE_PERCENT;
    process.env.CREDIT_SCORE_THRESHOLD = originalEnv.CREDIT_SCORE_THRESHOLD;
  });

  it("passes when required values are valid", () => {
    process.env.LOAN_MIN_SCORE = "520";
    process.env.LOAN_MAX_AMOUNT = "100000";
    process.env.LOAN_INTEREST_RATE_PERCENT = "15";
    process.env.CREDIT_SCORE_THRESHOLD = "650";

    expect(() => validateLoanConfig()).not.toThrow();
  });

  it("throws when required env var is missing", () => {
    delete process.env.LOAN_MIN_SCORE;
    process.env.LOAN_MAX_AMOUNT = "100000";
    process.env.LOAN_INTEREST_RATE_PERCENT = "15";
    process.env.CREDIT_SCORE_THRESHOLD = "650";

    expect(() => validateLoanConfig()).toThrow("LOAN_MIN_SCORE is required");
  });

  it("throws when numeric value is invalid", () => {
    process.env.LOAN_MIN_SCORE = "0";
    process.env.LOAN_MAX_AMOUNT = "100000";
    process.env.LOAN_INTEREST_RATE_PERCENT = "15";
    process.env.CREDIT_SCORE_THRESHOLD = "650";

    expect(() => validateLoanConfig()).toThrow(
      "LOAN_MIN_SCORE must be between 300 and 850",
    );
  });

  it("accepts decimal interest rate percent", () => {
    process.env.LOAN_MIN_SCORE = "500";
    process.env.LOAN_MAX_AMOUNT = "100000";
    process.env.LOAN_INTEREST_RATE_PERCENT = "14.1";
    process.env.CREDIT_SCORE_THRESHOLD = "650";

    expect(() => validateLoanConfig()).not.toThrow();
  });

  it("throws when non-numeric value is provided for interest rate", () => {
    process.env.LOAN_MIN_SCORE = "500";
    process.env.LOAN_MAX_AMOUNT = "100000";
    process.env.LOAN_INTEREST_RATE_PERCENT = "14.1abc";
    process.env.CREDIT_SCORE_THRESHOLD = "650";

    expect(() => validateLoanConfig()).toThrow(
      "LOAN_INTEREST_RATE_PERCENT must be a valid number",
    );
  });
});
