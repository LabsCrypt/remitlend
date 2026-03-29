import { jest } from "@jest/globals";

// Use unstable_mockModule for robust ESM mocking of the connection module.
jest.unstable_mockModule("../db/connection.js", () => ({
  query: jest.fn(),
  default: {
    query: jest.fn(),
  },
}));

// Use dynamic imports to ensure mocks are applied BEFORE the app as well as the test
const { query } = await import("../db/connection.js");
const { auditLog } = await import("../middleware/auditLog.js");
import type { Request, Response, NextFunction } from "express";

const mockedQuery = query as jest.MockedFunction<typeof query>;

describe("Audit Log Middleware", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = {
      method: "POST",
      path: "/admin/check-defaults",
      headers: {
        "x-api-key": "test-api-key",
      },
      body: {
        loanIds: [1, 2, 3],
      },
      ip: "127.0.0.1",
      socket: {} as any,
      params: {},
    };
    res = {};
    next = jest.fn();
    jest.clearAllMocks();
  });

  it("should log admin action to audit_logs table", async () => {
    await auditLog(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();

    // The query is called asynchronously (void ...), so we might need to wait a tick
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_logs"),
      expect.arrayContaining([
        "INTERNAL_API_KEY",
        "POST /admin/check-defaults",
        "LoanIDs:[1,2,3]",
        expect.stringContaining('"loanIds":[1,2,3]'),
        "127.0.0.1",
      ]),
    );
  });

  it("should redact sensitive fields in payload", async () => {
    req.body = {
      secret: "sensitive-data",
      loanId: 123,
    };

    await auditLog(req as Request, res as Response, next);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_logs"),
      expect.arrayContaining([
        expect.anything(),
        expect.anything(),
        "LoanID:123",
        expect.stringContaining("[REDACTED]"),
        expect.anything(),
      ]),
    );

    const callArgs = mockedQuery.mock.calls[0];
    const callPayload = callArgs?.[1]?.[3];

    if (typeof callPayload === "string") {
      const parsedPayload = JSON.parse(callPayload);
      expect(parsedPayload.secret).toBe("[REDACTED]");
      expect(parsedPayload.loanId).toBe(123);
    } else {
      throw new Error("Payload was not recorded as a string");
    }
  });

  it("should identify actor from JWT if present", async () => {
    (req as any).user = {
      publicKey: "G-STUDENT-WALLET-ADDR",
      role: "admin"
    };

    await auditLog(req as Request, res as Response, next);
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_logs"),
      expect.arrayContaining([
        "G-STUDENT-WALLET-ADDR",
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything()
      ])
    );
  });
});
