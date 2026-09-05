import { validateEnvVars } from '../config/env.js';
import { jest } from '@jest/globals';

jest.mock('../utils/logger.js');

describe('Environment Variable Validation', () => {
  const originalEnv = process.env;
  let mockExit: ReturnType<typeof jest.spyOn>;

  function setAllRequiredVars(): void {
    process.env.DATABASE_URL = 'postgres://localhost';
    process.env.REDIS_URL = 'redis://localhost';
    process.env.JWT_SECRET = 'secret';
    process.env.STELLAR_RPC_URL = 'http://localhost';
    process.env.STELLAR_NETWORK_PASSPHRASE = 'test';
    process.env.LOAN_MANAGER_CONTRACT_ID = 'C1';
    process.env.LENDING_POOL_CONTRACT_ID = 'C2';
    process.env.REMITTANCE_NFT_CONTRACT_ID = 'C3';
    process.env.MULTISIG_GOVERNANCE_CONTRACT_ID = 'C4';
    process.env.POOL_TOKEN_ADDRESS = 'T1';
    process.env.LOAN_MANAGER_ADMIN_SECRET = 'S1';
    process.env.INTERNAL_API_KEY = 'K1';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.SCORE_DELTA_REPAY = '15';
    process.env.SCORE_DELTA_DEFAULT = '50';
    process.env.SCORE_DELTA_LATE = '5';
    process.env.PII_KEK_KEY = 'a'.repeat(64);
  }

  beforeAll(() => {
    mockExit = jest
      .spyOn(process, 'exit')
      .mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`Process.exit called with ${code}`);
      });
  });

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    setAllRequiredVars();
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
    mockExit.mockRestore();
  });

  it('should not exit if all required variables are present', () => {
    expect(() => validateEnvVars()).not.toThrow();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('should exit with code 1 if a required variable is missing', () => {
    delete process.env.DATABASE_URL;

    expect(() => validateEnvVars()).toThrow('Process.exit called with 1');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should exit with code 1 if a required variable is empty string', () => {
    process.env.DATABASE_URL = '   ';

    expect(() => validateEnvVars()).toThrow('Process.exit called with 1');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should exit if neither PII_KEK_KEY nor PII_KMS_ENDPOINT is set', () => {
    delete process.env.PII_KEK_KEY;
    delete process.env.PII_KMS_ENDPOINT;

    expect(() => validateEnvVars()).toThrow('Process.exit called with 1');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should not exit if PII_KMS_ENDPOINT is set', () => {
    process.env.PII_KMS_ENDPOINT = 'https://kms.example.com';
    delete process.env.PII_KEK_KEY;

    expect(() => validateEnvVars()).not.toThrow();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('should not exit if PII_KEK_KEY is set', () => {
    delete process.env.PII_KMS_ENDPOINT;

    expect(() => validateEnvVars()).not.toThrow();
    expect(mockExit).not.toHaveBeenCalled();
  });
});
