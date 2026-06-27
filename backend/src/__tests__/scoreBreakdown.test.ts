import { jest } from "@jest/globals";
import request from "supertest";
import jwt from "jsonwebtoken";

// Mock the database connection module before any other imports
jest.unstable_mockModule("../db/connection.js", () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  withTransaction: jest.fn(),
  default: {
    query: jest.fn(),
  },
}));

// Mock CacheService to prevent Redis connections
jest.unstable_mockModule("../services/cacheService.js", () => ({
  cacheService: {
    get: jest.fn<() => Promise<null>>().mockResolvedValue(null),
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

describe("GET /api/score/:userId/breakdown", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should reject unauthenticated requests", async () => {
    const response = await request(app).get("/api/score/user123/breakdown");
    expect(response.status).toBe(401);
  });

  it("should return 403 for a token lacking read:score scope", async () => {
    const tokenWithoutReadScore = jwt.sign(
      {
        publicKey: "user123",
        role: "lender",
        scopes: ["read:loans", "read:pool"],
      },
      process.env.JWT_SECRET!,
      { algorithm: "HS256", expiresIn: "1h" },
    );

    const response = await request(app)
      .get("/api/score/user123/breakdown")
      .set("Authorization", `Bearer ${tokenWithoutReadScore}`);

    expect(response.status).toBe(403);
  });

  it("should return a breakdown for a valid userId", async () => {
    // Mock the optimized single CTE query (returns all breakdown metrics)
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          current_score: 720,
          total_loans: 5,
          repaid_count: 4,
          defaulted_count: 0,
          total_repaid: 5000,
          on_time_count: 3,
          late_count: 1,
          avg_repayment_ledgers: 17280,
        },
      ],
      command: "SELECT",
      rowCount: 1,
      oid: 0,
      fields: [],
    });
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          event_type: "LoanRepaid",
          ledger_closed_at: "2026-03-01T10:00:00Z",
        },
        {
          event_type: "LoanRepaid",
          ledger_closed_at: "2026-03-05T10:00:00Z",
        },
        {
          event_type: "LoanRepaid",
          ledger_closed_at: "2026-03-10T10:00:00Z",
        },
      ],
      command: "SELECT",
      rowCount: 3,
      oid: 0,
      fields: [],
    }); // History query

    const response = await request(app)
      .get("/api/score/user123/breakdown")
      .set(bearer("user123"));

    expect(response.status).toBe(200);
    expect(response.body.score).toBe(720);
    expect(response.body.breakdown.totalLoans).toBe(5);
    expect(response.body.breakdown.repaidOnTime).toBe(3);
    expect(response.body.breakdown.repaidLate).toBe(1);
    expect(response.body.breakdown.defaulted).toBe(0);
    expect(response.body.history).toHaveLength(3);
  });

  it("should return default values for a user with no history", async () => {
    // Mock empty breakdown and history queries
    mockedQuery
      .mockResolvedValueOnce({
        rows: [],
        command: "SELECT",
        rowCount: 0,
        oid: 0,
        fields: [],
      }) // Empty breakdown
      .mockResolvedValueOnce({
        rows: [],
        command: "SELECT",
        rowCount: 0,
        oid: 0,
        fields: [],
      }); // Empty history

    const response = await request(app)
      .get("/api/score/newuser/breakdown")
      .set(bearer("newuser"));

    expect(response.status).toBe(200);
    expect(response.body.score).toBe(500);
    expect(response.body.breakdown.totalLoans).toBe(0);
    expect(response.body.breakdown.repaidOnTime).toBe(0);
    expect(response.body.history).toHaveLength(0);
  });
});
