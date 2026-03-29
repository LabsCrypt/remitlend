import { jest } from "@jest/globals";
import request from "supertest";

// Mock the database connection module before any other imports
jest.unstable_mockModule("../db/connection.js", () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  default: {
    query: jest.fn(),
  },
}));

// Mock CacheService to prevent Redis connections
jest.unstable_mockModule("../services/cacheService.js", () => ({
  cacheService: {
    get: jest.fn<() => Promise<any>>().mockResolvedValue(null),
    set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ping: jest.fn<() => Promise<string>>().mockResolvedValue("ok"),
  },
}));

// Dynamic imports to ensure mocks are applied
const { query } = await import("../db/connection.js");
const { generateJwtToken } = await import("../services/authService.js");

// Set env vars
process.env.JWT_SECRET = "test-jwt-secret-min-32-chars-long!!";
process.env.INTERNAL_API_KEY = "test-internal-key";

const { default: app } = await import("../app.js");

const mockedQuery = query as jest.MockedFunction<typeof query>;

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

describe("GET /api/score/:userId", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should reject unauthenticated requests", async () => {
    const response = await request(app).get("/api/score/user123");
    expect(response.status).toBe(401);
  });

  it("should reject when path userId does not match JWT wallet", async () => {
    const response = await request(app)
      .get("/api/score/user123")
      .set(bearer("other-wallet"));

    expect(response.status).toBe(403);
  });

  it("should return a score for a valid userId", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ current_score: 750 }] } as any);

    const response = await request(app)
      .get("/api/score/user123")
      .set(bearer("user123"));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.userId).toBe("user123");
    expect(response.body.score).toBe(750);
  });

  it("should return the same score for the same userId", async () => {
    mockedQuery.mockResolvedValue({ rows: [{ current_score: 600 }] } as any);

    const r1 = await request(app).get("/api/score/alice").set(bearer("alice"));
    const r2 = await request(app).get("/api/score/alice").set(bearer("alice"));

    expect(r1.body.score).toBe(r2.body.score);
  });

  it("should return 500 if user not found", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] } as any);

    const response = await request(app)
      .get("/api/score/newuser")
      .set(bearer("newuser"));

    expect(response.status).toBe(200);
    expect(response.body.score).toBe(500);
  });
});

describe("POST /api/score/update", () => {
  it("should increase score by 15 for on-time repayment", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ current_score: 500 }] } as any);
    mockedQuery.mockResolvedValueOnce({ rows: [{ current_score: 515 }] } as any);

    const response = await request(app)
      .post("/api/score/update")
      .set("x-api-key", "test-internal-key")
      .send({ userId: "user123", repaymentAmount: 500, onTime: true });

    expect(response.status).toBe(200);
    expect(response.body.newScore).toBe(515);
  });

  it("should reject negative repaymentAmount", async () => {
    const response = await request(app)
      .post("/api/score/update")
      .set("x-api-key", "test-internal-key")
      .send({ userId: "user123", repaymentAmount: -100, onTime: true });

    expect(response.status).toBe(400);
  });
});
