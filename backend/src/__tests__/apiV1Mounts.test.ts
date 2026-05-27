import { jest } from "@jest/globals";
import jwt from "jsonwebtoken";
import request from "supertest";

type MockQueryResult = { rows: Record<string, unknown>[]; rowCount: number };

const VALID_API_KEY = "test-internal-key";
const TEST_PUBLIC_KEY =
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-min-32-chars-long!!";
process.env.INTERNAL_API_KEY = VALID_API_KEY;
process.env.POOL_TOKEN_ADDRESS = "test-pool-token";

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

jest.unstable_mockModule("../db/connection.js", () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.unstable_mockModule("../db/transaction.js", () => ({
  withTransaction: jest.fn(),
  withStellarAndDbTransaction: jest.fn(),
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

await import("../db/connection.js");
const { default: app } = await import("../app.js");

const dbRows = (rows: Record<string, unknown>[]): MockQueryResult => ({
  rows,
  rowCount: rows.length,
});

const bearer = () => {
  const token = jwt.sign(
    {
      publicKey: TEST_PUBLIC_KEY,
      role: "admin",
      scopes: ["admin:all"],
    },
    process.env.JWT_SECRET!,
    { algorithm: "HS256", expiresIn: "1h" },
  );

  return { Authorization: `Bearer ${token}` };
};

afterEach(() => {
  jest.clearAllMocks();
});

afterAll(() => {
  delete process.env.INTERNAL_API_KEY;
  delete process.env.JWT_SECRET;
  delete process.env.POOL_TOKEN_ADDRESS;
});

describe("API v1 router mounts", () => {
  it("mounts pool routes under /api/v1/pool", async () => {
    mockQuery
      .mockResolvedValueOnce(dbRows([{ total_deposits: "1000" }]))
      .mockResolvedValueOnce(
        dbRows([{ active_loans_count: "2", total_outstanding: "250" }]),
      );

    const response = await request(app).get("/api/v1/pool/stats").set(bearer());

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      totalDeposits: 1000,
      totalOutstanding: 250,
      activeLoansCount: 2,
      poolTokenAddress: "test-pool-token",
    });
  });

  it("mounts notifications routes under /api/v1/notifications", async () => {
    mockQuery
      .mockResolvedValueOnce(
        dbRows([
          {
            id: 1,
            user_id: TEST_PUBLIC_KEY,
            type: "score_changed",
            title: "Score updated",
            message: "Your score changed",
            loan_id: null,
            read: false,
            status: "unread",
            created_at: new Date("2026-05-27T00:00:00.000Z"),
          },
        ]),
      )
      .mockResolvedValueOnce(dbRows([{ count: "1" }]));

    const response = await request(app)
      .get("/api/v1/notifications")
      .set(bearer());

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.unreadCount).toBe(1);
    expect(response.body.data.notifications).toHaveLength(1);
  });

  it("mounts events routes under /api/v1/events", async () => {
    const response = await request(app)
      .get("/api/v1/events/status")
      .set("x-api-key", VALID_API_KEY);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual(
      expect.objectContaining({
        total: expect.any(Number),
        borrower: expect.any(Number),
        admin: expect.any(Number),
      }),
    );
  });
});
