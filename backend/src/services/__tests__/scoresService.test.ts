/**
 * Tests for scoresService.updateUserScoresBulk
 *
 * Verifies that the function:
 *  - Executes on the shared pool when no client is provided
 *  - Executes on the pinned client when one is provided (transaction participation)
 *  - Is a no-op for empty inputs
 *  - Propagates errors correctly
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
} from "@jest/globals";

let updateUserScoresBulk: (
  updates: Map<string, number>,
  client?: any,
) => Promise<void>;
let mockQuery: jest.Mock;
let mockLoggerInfo: jest.Mock;
let mockLoggerError: jest.Mock;

beforeAll(async () => {
  mockQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
  mockLoggerInfo = jest.fn();
  mockLoggerError = jest.fn();

  jest.unstable_mockModule("../../db/connection.js", () => ({
    query: mockQuery,
    getClient: jest.fn(),
    withTransaction: jest.fn(),
    TRANSIENT_ERROR_CODES: new Set(),
  }));

  jest.unstable_mockModule("../../utils/logger.js", () => ({
    default: {
      info: mockLoggerInfo,
      error: mockLoggerError,
      warn: jest.fn(),
      debug: jest.fn(),
    },
  }));

  const mod = await import("../scoresService.js");
  updateUserScoresBulk = mod.updateUserScoresBulk;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
});

// ---------------------------------------------------------------------------

describe("updateUserScoresBulk", () => {
  describe("standalone (no client)", () => {
    it("is a noop for an empty map", async () => {
      await updateUserScoresBulk(new Map());
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("is a noop when all user IDs are empty strings", async () => {
      await updateUserScoresBulk(new Map([["", 50]]));
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("calls pool query with correct placeholders for a single user", async () => {
      await updateUserScoresBulk(new Map([["user1", 10]]));

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];

      expect(sql).toContain("INSERT INTO scores");
      expect(sql).toContain("ON CONFLICT (user_id)");
      expect(params).toEqual(["user1", 10]);
    });

    it("calls pool query for multiple users in a single statement", async () => {
      const updates = new Map([
        ["alice", 15],
        ["bob", -20],
      ]);
      await updateUserScoresBulk(updates);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];

      // Expect both users in params
      expect(params).toContain("alice");
      expect(params).toContain("bob");
      expect(params).toContain(15);
      expect(params).toContain(-20);

      // Two value groups in the query
      expect(sql.match(/\$1/g)).toBeTruthy();
      expect(sql.match(/\$3/g)).toBeTruthy();
    });

    it("logs success after updating", async () => {
      await updateUserScoresBulk(new Map([["user1", 5]]));
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        "Applied bulk user score updates",
        { updatedCount: 1 },
      );
    });

    it("propagates db errors and logs them", async () => {
      mockQuery.mockRejectedValueOnce(new Error("db error"));

      await expect(
        updateUserScoresBulk(new Map([["user1", 5]])),
      ).rejects.toThrow("db error");

      expect(mockLoggerError).toHaveBeenCalledWith(
        "Failed to apply bulk user score updates",
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });
  });

  describe("with pinned client (inside transaction)", () => {
    it("uses client.query instead of pool query", async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
      };

      await updateUserScoresBulk(new Map([["user1", 10]]), mockClient as any);

      // Pool-level query must NOT be called
      expect(mockQuery).not.toHaveBeenCalled();

      // Client query IS called
      expect(mockClient.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockClient.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain("INSERT INTO scores");
      expect(params).toContain("user1");
    });

    it("propagates errors from client.query", async () => {
      const mockClient = {
        query: jest.fn().mockRejectedValueOnce(new Error("client fail")),
      };

      await expect(
        updateUserScoresBulk(new Map([["user1", 5]]), mockClient as any),
      ).rejects.toThrow("client fail");
    });

    it("is a noop for empty map even with a client", async () => {
      const mockClient = { query: jest.fn() };

      await updateUserScoresBulk(new Map(), mockClient as any);

      expect(mockClient.query).not.toHaveBeenCalled();
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});
