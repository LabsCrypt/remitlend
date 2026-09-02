import { jest } from '@jest/globals';
import { validateLoanConfig, validateLoanConfigOnStartup } from '../config/loanConfig.js';

describe('Loan config startup validation', () => {
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

  it('passes when required values are valid', () => {
    process.env.LOAN_MIN_SCORE = '520';
    process.env.LOAN_MAX_AMOUNT = '100000';
    process.env.LOAN_INTEREST_RATE_PERCENT = '15';
    process.env.CREDIT_SCORE_THRESHOLD = '650';

    expect(() => validateLoanConfig()).not.toThrow();
  });

  it('throws when required env var is missing', () => {
    delete process.env.LOAN_MIN_SCORE;
    process.env.LOAN_MAX_AMOUNT = '100000';
    process.env.LOAN_INTEREST_RATE_PERCENT = '15';
    process.env.CREDIT_SCORE_THRESHOLD = '650';

    expect(() => validateLoanConfig()).toThrow('LOAN_MIN_SCORE is required');
  });

  it('throws when numeric value is invalid', () => {
    process.env.LOAN_MIN_SCORE = '0';
    process.env.LOAN_MAX_AMOUNT = '100000';
    process.env.LOAN_INTEREST_RATE_PERCENT = '15';
    process.env.CREDIT_SCORE_THRESHOLD = '650';

    expect(() => validateLoanConfig()).toThrow('LOAN_MIN_SCORE must be between 300 and 850');
  });

  it('accepts decimal interest rate percent', () => {
    process.env.LOAN_MIN_SCORE = '500';
    process.env.LOAN_MAX_AMOUNT = '100000';
    process.env.LOAN_INTEREST_RATE_PERCENT = '14.1';
    process.env.CREDIT_SCORE_THRESHOLD = '650';

    expect(() => validateLoanConfig()).not.toThrow();
  });

  it('throws when non-numeric value is provided for interest rate', () => {
    process.env.LOAN_MIN_SCORE = '500';
    process.env.LOAN_MAX_AMOUNT = '100000';
    process.env.LOAN_INTEREST_RATE_PERCENT = '14.1abc';
    process.env.CREDIT_SCORE_THRESHOLD = '650';

    expect(() => validateLoanConfig()).toThrow('LOAN_INTEREST_RATE_PERCENT must be a valid number');
  });
});

describe('validateLoanConfigOnStartup', () => {
  const originalEnv = {
    LOAN_MIN_SCORE: process.env.LOAN_MIN_SCORE,
    LOAN_MAX_AMOUNT: process.env.LOAN_MAX_AMOUNT,
    LOAN_INTEREST_RATE_PERCENT: process.env.LOAN_INTEREST_RATE_PERCENT,
    CREDIT_SCORE_THRESHOLD: process.env.CREDIT_SCORE_THRESHOLD,
  };

  let processExitSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    processExitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((_code?: string | number | null) => undefined as never);
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.LOAN_MIN_SCORE = originalEnv.LOAN_MIN_SCORE;
    process.env.LOAN_MAX_AMOUNT = originalEnv.LOAN_MAX_AMOUNT;
    process.env.LOAN_INTEREST_RATE_PERCENT = originalEnv.LOAN_INTEREST_RATE_PERCENT;
    process.env.CREDIT_SCORE_THRESHOLD = originalEnv.CREDIT_SCORE_THRESHOLD;
    processExitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('succeeds silently when all loan config vars are valid', () => {
    process.env.LOAN_MIN_SCORE = '500';
    process.env.LOAN_MAX_AMOUNT = '100000';
    process.env.LOAN_INTEREST_RATE_PERCENT = '15';
    process.env.CREDIT_SCORE_THRESHOLD = '650';

    expect(() => validateLoanConfigOnStartup()).not.toThrow();
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('calls process.exit(1) and logs when a required var is missing', () => {
    delete process.env.LOAN_MIN_SCORE;
    process.env.LOAN_MAX_AMOUNT = '100000';
    process.env.LOAN_INTEREST_RATE_PERCENT = '15';
    process.env.CREDIT_SCORE_THRESHOLD = '650';

    validateLoanConfigOnStartup();

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
    const logged: string = consoleErrorSpy.mock.calls[0][0] as string;
    expect(logged).toMatch(/LOAN_MIN_SCORE is required/i);
  });

  it('calls process.exit(1) when a value is out of range', () => {
    process.env.LOAN_MIN_SCORE = '0'; // below min 300
    process.env.LOAN_MAX_AMOUNT = '100000';
    process.env.LOAN_INTEREST_RATE_PERCENT = '15';
    process.env.CREDIT_SCORE_THRESHOLD = '650';

    validateLoanConfigOnStartup();

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
