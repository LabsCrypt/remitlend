// Set up environment variables for testing BEFORE any imports
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://test:test@localhost:5432/remitlend_test";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379/1";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-secret-key-for-testing-only";
process.env.STELLAR_RPC_URL =
  process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org:443";
process.env.STELLAR_NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK_PASSPHRASE || "Test SDF Network ; September 2015";
process.env.LOAN_MANAGER_CONTRACT_ID =
  process.env.LOAN_MANAGER_CONTRACT_ID ||
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
process.env.LENDING_POOL_CONTRACT_ID =
  process.env.LENDING_POOL_CONTRACT_ID ||
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
process.env.POOL_TOKEN_ADDRESS =
  process.env.POOL_TOKEN_ADDRESS ||
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
process.env.LOAN_MANAGER_ADMIN_SECRET =
  process.env.LOAN_MANAGER_ADMIN_SECRET || "test-secret";
process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || "test-api-key";

import { jest } from "@jest/globals";

// We've found that global mocks in ESM can be tricky and lead to 'read-only' errors.
// Individual test files should use jest.unstable_mockModule for robust ESM mocking.

// We'll keep this file for any non-mock initialization if needed.
