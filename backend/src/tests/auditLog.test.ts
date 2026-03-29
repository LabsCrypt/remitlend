import { auditLog } from "../middleware/auditLog.js";
import { query } from "../db/connection.js";
import { jest } from "@jest/globals";
import type { Request, Response, NextFunction } from "express";

// Helper to cast to jest.Mock
const asMock = (fn: any) => fn as jest.Mock;

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
    // but Jest should see it if it's already triggered.
    // Actually, in a real unit test we'd probably want to await the logging if we could,
    // but here we just check if query was called with correct parameters.
    
    // We give it a small delay for the async 'void' block to run
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_logs"),
      expect.arrayContaining([
        "INTERNAL_API_KEY",
        "POST /admin/check-defaults",
        "LoanIDs:[1,2,3]",
        expect.stringContaining('"loanIds":[1,2,3]'),
        "127.0.0.1"
      ])
    );
  });

  it("should redact sensitive fields in payload", async () => {
    req.body = {
      secret: "sensitive-data",
      loanId: 123
    };

    await auditLog(req as Request, res as Response, next);
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_logs"),
      expect.arrayContaining([
        expect.anything(),
        expect.anything(),
        "LoanID:123",
        expect.stringContaining("[REDACTED]"),
        expect.anything()
      ])
    );

    const callPayload = asMock(query).mock.calls[0][1][3];
    const parsedPayload = JSON.parse(callPayload);
    expect(parsedPayload.secret).toBe("[REDACTED]");
    expect(parsedPayload.loanId).toBe(123);
  });

  it("should identify actor from JWT if present", async () => {
    (req as any).user = {
      publicKey: "G-STUDENT-WALLET-ADDR",
      role: "admin"
    };

    await auditLog(req as Request, res as Response, next);
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(query).toHaveBeenCalledWith(
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
