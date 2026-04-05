import { validateEnvVars } from "../config/env.js";
import { jest } from "@jest/globals";

jest.mock("../utils/logger.js");

describe("Environment Variable Validation", () => {
  const originalEnv = process.env;
  let mockExit: any;

  beforeAll(() => {
    mockExit = jest
      .spyOn(process, "exit")
      .mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`Process.exit called with ${code}`);
      });
  });

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
    mockExit.mockRestore();
  });

  it("should not exit if all required variables are present", () => {
    // All required variables are expected to be in originalEnv/process.env
    // or we set them here for the test
    process.env.DATABASE_URL = "postgres://localhost";
    process.env.REDIS_URL = "redis://localhost";
    process.env.JWT_SECRET = "secret";
    process.env.STELLAR_RPC_URL = "http://localhost";
    process.env.STELLAR_NETWORK_PASSPHRASE = "test";
    process.env.LOAN_MANAGER_CONTRACT_ID = "C1";
    process.env.LENDING_POOL_CONTRACT_ID = "C2";
    process.env.POOL_TOKEN_ADDRESS = "T1";
    process.env.LOAN_MANAGER_ADMIN_SECRET = "S1";
    process.env.INTERNAL_API_KEY = "K1";

    expect(() => validateEnvVars()).not.toThrow();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("should exit with code 1 if a required variable is missing", () => {
    delete process.env.DATABASE_URL;

    expect(() => validateEnvVars()).toThrow("Process.exit called with 1");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should exit with code 1 if a required variable is empty string", () => {
    process.env.DATABASE_URL = "   ";

    expect(() => validateEnvVars()).toThrow("Process.exit called with 1");
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
