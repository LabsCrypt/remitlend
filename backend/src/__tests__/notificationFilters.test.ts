import request from "supertest";
import { jest } from "@jest/globals";
import { generateJwtToken } from "../services/authService.js";

type MockQueryResult = { rows: unknown[]; rowCount?: number };

process.env.JWT_SECRET = "test-jwt-secret-min-32-chars-long!!";

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

const userId = "GTESTUSER1111111111111111111111111111111111111111111111111";

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

beforeEach(() => {
  mockQuery.mockReset();
  jest.clearAllMocks();
});

afterAll(() => {
  delete process.env.JWT_SECRET;
});

describe("notification filters", () => {
  it("filters notifications by type", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          user_id: userId,
          type: "repayment_due",
          title: "Repayment Due",
          message: "Your repayment is due",
          loan_id: 1,
          read: false,
          status: "unread",
          created_at: new Date("2024-03-15"),
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ count: "1" }],
    });

    const response = await request(app)
      .get("/api/notifications?type=repayment_due")
      .set(bearer(userId));

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.notifications).toHaveLength(1);
    expect(response.body.data.notifications[0].type).toBe("repayment_due");
  });

  it("filters notifications by status", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 2,
          user_id: userId,
          type: "loan_approved",
          title: "Loan Approved",
          message: "Your loan has been approved",
          loan_id: 2,
          read: true,
          status: "read",
          created_at: new Date("2024-03-10"),
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ count: "1" }],
    });

    const response = await request(app)
      .get("/api/notifications?status=read")
      .set(bearer(userId));

    expect(response.status).toBe(200);
    expect(response.body.data.notifications).toHaveLength(1);
    expect(response.body.data.notifications[0].status).toBe("read");
  });

  it("filters notifications by date range", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 3,
          user_id: userId,
          type: "score_changed",
          title: "Score Changed",
          message: "Your score has changed",
          loan_id: null,
          read: false,
          status: "unread",
          created_at: new Date("2024-03-20"),
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ count: "1" }],
    });

    const response = await request(app)
      .get("/api/notifications?from=2024-03-01&to=2024-03-31")
      .set(bearer(userId));

    expect(response.status).toBe(200);
    expect(response.body.data.notifications).toHaveLength(1);
  });

  it("combines multiple filters", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 4,
          user_id: userId,
          type: "repayment_confirmed",
          title: "Repayment Confirmed",
          message: "Your repayment has been confirmed",
          loan_id: 3,
          read: true,
          status: "read",
          created_at: new Date("2024-03-25"),
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ count: "1" }],
    });

    const response = await request(app)
      .get(
        "/api/notifications?type=repayment_confirmed&status=read&from=2024-03-01&to=2024-03-31",
      )
      .set(bearer(userId));

    expect(response.status).toBe(200);
    expect(response.body.data.notifications).toHaveLength(1);
    expect(response.body.data.notifications[0].type).toBe(
      "repayment_confirmed",
    );
    expect(response.body.data.notifications[0].status).toBe("read");
  });

  it("rejects invalid date formats", async () => {
    const response = await request(app)
      .get("/api/notifications?from=invalid-date")
      .set(bearer(userId));

    expect(response.status).toBe(400);
  });

  it("respects limit parameter", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        user_id: userId,
        type: "loan_approved",
        title: "Loan Approved",
        message: "Your loan has been approved",
        loan_id: i + 1,
        read: false,
        status: "unread",
        created_at: new Date("2024-03-15"),
      })),
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ count: "10" }],
    });

    const response = await request(app)
      .get("/api/notifications?limit=10")
      .set(bearer(userId));

    expect(response.status).toBe(200);
    expect(response.body.data.notifications).toHaveLength(10);
  });
});
