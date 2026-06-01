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
const { notificationService } =
  await import("../services/notificationService.js");

const userId = "GTESTUSER1111111111111111111111111111111111111111111111111";

beforeEach(() => {
  mockQuery.mockReset();
  jest.clearAllMocks();
});

afterAll(() => {
  delete process.env.JWT_SECRET;
});

describe("notification digest batching", () => {
  it("batches repayment notifications with digest mode off", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ digest_frequency: "off" }],
    });

    const notifications = [
      { userId, message: "Loan 1 due", loanId: 1 },
      { userId, message: "Loan 2 due", loanId: 2 },
      { userId, message: "Loan 3 due", loanId: 3 },
    ];

    const grouped =
      await notificationService.batchRepaymentNotificationsForDigest(
        notifications,
      );

    expect(grouped.size).toBe(1);
    expect(grouped.has(`${userId}:immediate`)).toBe(true);
    expect(grouped.get(`${userId}:immediate`)).toHaveLength(3);
  });

  it("batches repayment notifications with daily digest mode", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ digest_frequency: "daily" }],
    });

    const notifications = [
      { userId, message: "Loan 1 due", loanId: 1 },
      { userId, message: "Loan 2 due", loanId: 2 },
    ];

    const grouped =
      await notificationService.batchRepaymentNotificationsForDigest(
        notifications,
      );

    expect(grouped.size).toBe(1);
    expect(grouped.has(`${userId}:daily`)).toBe(true);
    expect(grouped.get(`${userId}:daily`)).toHaveLength(2);
  });

  it("batches repayment notifications with weekly digest mode", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ digest_frequency: "weekly" }],
    });

    const notifications = [
      { userId, message: "Loan 1 due", loanId: 1 },
      { userId, message: "Loan 2 due", loanId: 2 },
      { userId, message: "Loan 3 due", loanId: 3 },
    ];

    const grouped =
      await notificationService.batchRepaymentNotificationsForDigest(
        notifications,
      );

    expect(grouped.size).toBe(1);
    expect(grouped.has(`${userId}:weekly`)).toBe(true);
    expect(grouped.get(`${userId}:weekly`)).toHaveLength(3);
  });

  it("handles multiple users with different digest preferences", async () => {
    const user1 = "GUSER1111111111111111111111111111111111111111111111111111";
    const user2 = "GUSER2222222222222222222222222222222222222222222222222222";

    // A user has a single digest preference, so the lookup must be keyed by
    // user id rather than by call order: user1 is always daily, user2 weekly.
    mockQuery.mockImplementation(async (_text, params) => {
      const uid = (params as unknown[] | undefined)?.[0];
      if (uid === user1) {
        return { rows: [{ digest_frequency: "daily" }] };
      }
      if (uid === user2) {
        return { rows: [{ digest_frequency: "weekly" }] };
      }
      return { rows: [] };
    });

    const notifications = [
      { userId: user1, message: "Loan 1 due", loanId: 1 },
      { userId: user2, message: "Loan 2 due", loanId: 2 },
      { userId: user1, message: "Loan 3 due", loanId: 3 },
    ];

    const grouped =
      await notificationService.batchRepaymentNotificationsForDigest(
        notifications,
      );

    expect(grouped.size).toBe(2);
    expect(grouped.get(`${user1}:daily`)).toHaveLength(2);
    expect(grouped.get(`${user2}:weekly`)).toHaveLength(1);
  });

  it("defaults to off when digest_frequency is not set", async () => {
    mockQuery.mockResolvedValue({
      rows: [],
    });

    const notifications = [{ userId, message: "Loan 1 due", loanId: 1 }];

    const grouped =
      await notificationService.batchRepaymentNotificationsForDigest(
        notifications,
      );

    expect(grouped.has(`${userId}:immediate`)).toBe(true);
  });
});
