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

await import("../db/connection.js");
const { default: app } = await import("../app.js");
const { eventStreamService } =
  await import("../services/eventStreamService.js");

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
// GET /api/events/stream
// ---------------------------------------------------------------------------
describe("GET /api/events/stream", () => {
  it("should reject unauthenticated SSE requests", async () => {
    const response = await request(app).get("/api/events/stream");
    expect(response.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/events/status
// ---------------------------------------------------------------------------
describe("GET /api/events/status", () => {
  it("should reject requests without API key", async () => {
    const response = await request(app).get("/api/events/status");
    expect(response.status).toBe(401);
  });

  it("should return connection counts with valid API key", async () => {
    const response = await request(app)
      .get("/api/events/status")
      .set("x-api-key", VALID_API_KEY);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toBeDefined();
    expect(typeof response.body.data.total).toBe("number");
    expect(typeof response.body.data.borrower).toBe("number");
    expect(typeof response.body.data.admin).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// EventStreamService unit tests
// ---------------------------------------------------------------------------
describe("EventStreamService", () => {
  it("should track connection counts", () => {
    const counts = eventStreamService.getConnectionCount();
    expect(counts.total).toBeGreaterThanOrEqual(0);
    expect(counts.borrower).toBeGreaterThanOrEqual(0);
    expect(counts.admin).toBeGreaterThanOrEqual(0);
  });

  it("should subscribe and unsubscribe borrower clients", () => {
    const mockRes = {
      write: jest.fn(),
    } as unknown as import("express").Response;

    const unsubscribe = eventStreamService.subscribeBorrower(
      "testUser",
      mockRes,
    );
    const counts = eventStreamService.getConnectionCount();
    expect(counts.borrower).toBeGreaterThanOrEqual(1);

    unsubscribe();
    const countsAfter = eventStreamService.getConnectionCount();
    expect(countsAfter.borrower).toBeLessThan(counts.borrower + 1);
  });

  it("should subscribe and unsubscribe admin clients", () => {
    const mockRes = {
      write: jest.fn(),
    } as unknown as import("express").Response;

    const unsubscribe = eventStreamService.subscribeAll(mockRes);
    const counts = eventStreamService.getConnectionCount();
    expect(counts.admin).toBeGreaterThanOrEqual(1);

    unsubscribe();
  });

  it("should broadcast events to borrower clients", () => {
    const mockRes = {
      write: jest.fn(),
    } as unknown as import("express").Response;

    const unsubscribe = eventStreamService.subscribeBorrower(
      "BORROWER1",
      mockRes,
    );

    eventStreamService.broadcast({
      eventId: "evt-1",
      eventType: "LoanRepaid",
      borrower: "BORROWER1",
      ledger: 1000,
      ledgerClosedAt: "2026-03-01T00:00:00Z",
      txHash: "abc123",
    });

    expect(mockRes.write).toHaveBeenCalledTimes(1);
    const writtenData = (mockRes.write as jest.Mock).mock
      .calls[0]?.[0] as string;
    expect(writtenData).toContain("LoanRepaid");

    unsubscribe();
  });

  it("should broadcast events to admin clients", () => {
    const mockRes = {
      write: jest.fn(),
    } as unknown as import("express").Response;

    const unsubscribe = eventStreamService.subscribeAll(mockRes);

    eventStreamService.broadcast({
      eventId: "evt-2",
      eventType: "LoanApproved",
      borrower: "SOMEONE",
      ledger: 2000,
      ledgerClosedAt: "2026-03-02T00:00:00Z",
      txHash: "def456",
    });

    expect(mockRes.write).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("should not broadcast to unrelated borrower clients", () => {
    const mockRes = {
      write: jest.fn(),
    } as unknown as import("express").Response;

    const unsubscribe = eventStreamService.subscribeBorrower(
      "BORROWER_A",
      mockRes,
    );

    eventStreamService.broadcast({
      eventId: "evt-3",
      eventType: "LoanRepaid",
      borrower: "BORROWER_B",
      ledger: 3000,
      ledgerClosedAt: "2026-03-03T00:00:00Z",
      txHash: "ghi789",
    });

    expect(mockRes.write).not.toHaveBeenCalled();

    unsubscribe();
  });
});
