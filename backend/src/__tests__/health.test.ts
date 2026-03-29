import { jest } from "@jest/globals";
import request from "supertest";

// Use unstable_mockModule for robust ESM mocking
jest.unstable_mockModule("../db/connection.js", () => ({
  default: {
    query: jest.fn<() => Promise<any>>().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
  query: jest.fn<() => Promise<any>>().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

jest.unstable_mockModule("../services/cacheService.js", () => ({
  cacheService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue("ok"),
  },
}));

// Use dynamic import for app to ensure mocks are applied
const { default: app } = await import("../app.js");

describe("GET /health", () => {
  it("should return 200 or 503 with a status field", async () => {
    const response = await request(app).get("/health");

    expect([200, 503]).toContain(response.status);
    expect(["ok", "degraded"]).toContain(response.body.status);
  });

  it("should always report api check as ok", async () => {
    const response = await request(app).get("/health");

    expect(response.body).toHaveProperty("checks");
    expect(response.body.checks.api).toBe("ok");
  });

  it("should include soroban_rpc in checks", async () => {
    const response = await request(app).get("/health");

    expect(response.body.checks).toHaveProperty("soroban_rpc");
    expect(["ok", "error"]).toContain(response.body.checks.soroban_rpc);
  });

  it("should return uptime as a number", async () => {
    const response = await request(app).get("/health");

    expect(response.body).toHaveProperty("uptime");
    expect(typeof response.body.uptime).toBe("number");
  });

  it("should return timestamp as a number", async () => {
    const response = await request(app).get("/health");

    expect(response.body).toHaveProperty("timestamp");
    expect(typeof response.body.timestamp).toBe("number");
  });
});
