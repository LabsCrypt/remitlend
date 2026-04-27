import { jest } from "@jest/globals";
import request from "supertest";

jest.setTimeout(60000);

const loadApp = async () => {
  jest.resetModules();
  const mockQuery = jest.fn<
    (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>
  >().mockResolvedValue({ rows: [], rowCount: 0 });

  jest.unstable_mockModule("../db/connection.js", () => ({
    default: {
      query: mockQuery,
    },
    query: mockQuery,
    getClient: jest.fn(),
    closePool: jest.fn(),
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

  return import("../app.js");
};

describe("CORS middleware", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = "production";
    process.env.FRONTEND_URL = "https://frontend.example.com";
    delete process.env.CORS_ALLOWED_ORIGINS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("allows the configured frontend origin", async () => {
    const { default: app } = await loadApp();

    const response = await request(app)
      .get("/health")
      .set("Origin", "https://frontend.example.com");

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "https://frontend.example.com",
    );
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("rejects unknown origins in production", async () => {
    const { default: app } = await loadApp();

    const response = await request(app)
      .get("/health")
      .set("Origin", "https://malicious.example.com");

    expect(response.status).toBe(403);
    expect(response.body.error?.message).toBe("Origin is not allowed by CORS policy");
  });
});
