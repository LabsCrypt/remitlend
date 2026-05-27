import { jest } from "@jest/globals";
import request from "supertest";

// Must mock all app-level dependencies before importing app.

jest.unstable_mockModule("../db/connection.js", () => ({
  default: {
    query: jest
      .fn<() => Promise<any>>()
      .mockResolvedValue({ rows: [], rowCount: 0 }),
  },
  query: jest
    .fn<() => Promise<any>>()
    .mockResolvedValue({ rows: [], rowCount: 0 }),
  getClient: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.unstable_mockModule("../services/cacheService.js", () => ({
  cacheService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue("ok"),
  },
}));

jest.unstable_mockModule("../services/sorobanService.js", () => ({
  sorobanService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue("ok"),
  },
}));

const { default: app } = await import("../app.js");

describe("GET /version", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Snapshot and clear the build-time env vars so each test starts clean.
    for (const key of [
      "GIT_SHA",
      "BUILD_TIME",
      "LOAN_MANAGER_CONTRACT_ID",
      "LENDING_POOL_CONTRACT_ID",
      "REMITTANCE_NFT_CONTRACT_ID",
      "MULTISIG_GOVERNANCE_CONTRACT_ID",
    ]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    // Restore original env.
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("returns 200", async () => {
    const res = await request(app).get("/version");
    expect(res.status).toBe(200);
  });

  it("response shape contains all required fields", async () => {
    const res = await request(app).get("/version");
    expect(res.body).toHaveProperty("gitSha");
    expect(res.body).toHaveProperty("builtAt");
    expect(res.body).toHaveProperty("nodeVersion");
    expect(res.body).toHaveProperty("contracts");
    expect(res.body.contracts).toHaveProperty("loanManager");
    expect(res.body.contracts).toHaveProperty("lendingPool");
    expect(res.body.contracts).toHaveProperty("remittanceNft");
    expect(res.body.contracts).toHaveProperty("multisigGovernance");
  });

  it("falls back to 'unknown' when GIT_SHA and BUILD_TIME are not set", async () => {
    const res = await request(app).get("/version");
    expect(res.body.gitSha).toBe("unknown");
    expect(res.body.builtAt).toBe("unknown");
  });

  it("reflects GIT_SHA and BUILD_TIME env vars when set", async () => {
    process.env.GIT_SHA = "abc1234def5678";
    process.env.BUILD_TIME = "2025-06-01T12:00:00Z";

    const res = await request(app).get("/version");
    expect(res.body.gitSha).toBe("abc1234def5678");
    expect(res.body.builtAt).toBe("2025-06-01T12:00:00Z");
  });

  it("reflects contract IDs from environment variables", async () => {
    process.env.LOAN_MANAGER_CONTRACT_ID = "CLOAN";
    process.env.LENDING_POOL_CONTRACT_ID = "CPOOL";
    process.env.REMITTANCE_NFT_CONTRACT_ID = "CNFT";
    process.env.MULTISIG_GOVERNANCE_CONTRACT_ID = "CGOV";

    const res = await request(app).get("/version");
    expect(res.body.contracts.loanManager).toBe("CLOAN");
    expect(res.body.contracts.lendingPool).toBe("CPOOL");
    expect(res.body.contracts.remittanceNft).toBe("CNFT");
    expect(res.body.contracts.multisigGovernance).toBe("CGOV");
  });

  it("contract IDs fall back to 'unknown' when env vars are absent", async () => {
    const res = await request(app).get("/version");
    expect(res.body.contracts.loanManager).toBe("unknown");
    expect(res.body.contracts.lendingPool).toBe("unknown");
    expect(res.body.contracts.remittanceNft).toBe("unknown");
    expect(res.body.contracts.multisigGovernance).toBe("unknown");
  });

  it("nodeVersion matches the running Node.js process", async () => {
    const res = await request(app).get("/version");
    expect(res.body.nodeVersion).toBe(process.version);
  });
});
