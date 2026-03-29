import request from "supertest";
import { jest } from "@jest/globals";
import { generateJwtToken } from "../services/authService.js";

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const VALID_API_KEY = "test-internal-key";

process.env.JWT_SECRET = "test-jwt-secret-min-32-chars-long!!";
process.env.INTERNAL_API_KEY = VALID_API_KEY;

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();
jest.unstable_mockModule("../db/connection.js", () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
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

await import("../db/connection.js");
const { default: app } = await import("../app.js");

const mockedQuery = mockQuery;

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

afterEach(() => {
  jest.clearAllMocks();
});

afterAll(() => {
  delete process.env.INTERNAL_API_KEY;
  delete process.env.JWT_SECRET;
});

// ---------------------------------------------------------------------------
// GET /api/score/:userId/breakdown
// ---------------------------------------------------------------------------
describe("GET /api/score/:userId/breakdown", () => {
  it("should reject unauthenticated requests", async () => {
    const response = await request(app).get("/api/score/user123/breakdown");
    expect(response.status).toBe(401);
  });

  it("should reject when userId does not match JWT wallet", async () => {
    const response = await request(app)
      .get("/api/score/user123/breakdown")
      .set(bearer("other-wallet"));
    expect(response.status).toBe(403);
  });

  it("should return a breakdown for a valid userId", async () => {
    // Score query
    mockedQuery.mockResolvedValueOnce({ rows: [{ current_score: 720 }] });
    // Stats query
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          total_loans: "5",
          repaid_count: "4",
          defaulted_count: "0",
          total_repaid: "5000",
        },
      ],
    });
    // Repayment timing query
    mockedQuery.mockResolvedValueOnce({
      rows: [{ on_time: "3", late: "1" }],
    });
    // Average repayment time
    mockedQuery.mockResolvedValueOnce({
      rows: [{ avg_ledgers: "17280" }],
    });
    // Streak data
    mockedQuery.mockResolvedValueOnce({
      rows: [
        { on_time: true },
        { on_time: true },
        { on_time: true },
        { on_time: false },
      ],
    });
    // History
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          date: "2026-03-01T00:00:00Z",
          event: "LoanRepaid",
        },
        {
          date: "2026-03-15T00:00:00Z",
          event: "LoanRepaid",
        },
      ],
    });

    const response = await request(app)
      .get("/api/score/user123/breakdown")
      .set(bearer("user123"));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.score).toBe(720);
    expect(response.body.band).toBe("Good");
    expect(response.body.breakdown).toBeDefined();
    expect(response.body.breakdown.totalLoans).toBe(5);
    expect(response.body.breakdown.repaidOnTime).toBe(3);
    expect(response.body.breakdown.repaidLate).toBe(1);
    expect(response.body.breakdown.defaulted).toBe(0);
    expect(response.body.breakdown.totalRepaid).toBe(5000);
    expect(response.body.breakdown.averageRepaymentTime).toBeDefined();
    expect(response.body.breakdown.longestStreak).toBe(3);
    expect(response.body.history).toBeInstanceOf(Array);
    expect(response.body.history.length).toBe(2);
  });

  it("should return default values for a user with no history", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] }); // No score
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          total_loans: "0",
          repaid_count: "0",
          defaulted_count: "0",
          total_repaid: "0",
        },
      ],
    });
    mockedQuery.mockResolvedValueOnce({ rows: [{ on_time: "0", late: "0" }] });
    mockedQuery.mockResolvedValueOnce({ rows: [{ avg_ledgers: null }] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .get("/api/score/newuser/breakdown")
      .set(bearer("newuser"));

    expect(response.status).toBe(200);
    expect(response.body.score).toBe(500);
    expect(response.body.breakdown.totalLoans).toBe(0);
    expect(response.body.breakdown.averageRepaymentTime).toBe("N/A");
    expect(response.body.history).toEqual([]);
  });
});
