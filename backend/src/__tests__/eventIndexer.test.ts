import { EventIndexer } from "../../src/services/eventIndexer.js";
import { webhookService } from "../../src/services/webhookService.js";
import { query } from "../../src/db/connection.js";

// --------------------
// MOCKS
// --------------------

// Mock DB
jest.mock("../../src/db/connection.js", () => ({
  query: jest.fn(),
}));

// Mock Redis
jest.mock("ioredis", () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
    connect: jest.fn(),
    quit: jest.fn(),
  }));
});

// Mock webhook service
jest.mock("../../src/services/webhookService.js", () => ({
  webhookService: { dispatch: jest.fn() },
}));

// --------------------
// SETUP TYPES
// --------------------
const mockQuery = query as jest.Mock;
const mockDispatch = webhookService.dispatch as jest.Mock;

// --------------------
// TEST SUITE
// --------------------
describe("EventIndexer Integration Tests", () => {
  let indexer: EventIndexer;

  beforeEach(() => {
    jest.clearAllMocks();
    indexer = new EventIndexer("http://rpc", "contract-123");
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  // Helper to build a simple mock event
  function buildEvent(type: string, borrower?: string, loanId?: number, amount?: string) {
    return {
      id: "evt-" + Math.random().toString(36).substr(2, 5),
      pagingToken: "1",
      ledger: 100,
      ledgerClosedAt: new Date(),
      txHash: "tx1",
      contractId: "contract-123",
      eventType: type,
      borrower: borrower || "",
      loanId,
      amount,
      topics: [type],
      value: amount || "100",
    };
  }

  // =========================
  // EVENT PARSING
  // =========================
  it("parses LoanRequested event", async () => {
    const event = buildEvent("LoanRequested", "user1", undefined, "500");

    await (indexer as any)["storeEvents"]([event]);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO loan_events"),
      expect.any(Array)
    );
  });

  it("parses LoanApproved event", async () => {
    const event = buildEvent("LoanApproved", "user1", 1);

    await (indexer as any)["storeEvents"]([event]);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO loan_events"),
      expect.any(Array)
    );
  });

  it("parses LoanRepaid and updates score", async () => {
    const event = buildEvent("LoanRepaid", "user1", 1, "300");

    await (indexer as any)["storeEvents"]([event]);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO scores"),
      expect.any(Array)
    );
  });

  it("parses LoanDefaulted and penalizes score", async () => {
    const event = buildEvent("LoanDefaulted", "user1", 1);

    await (indexer as any)["storeEvents"]([event]);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO scores"),
      expect.any(Array)
    );
  });

  // =========================
  // DEDUPLICATION
  // =========================
  it("skips duplicate events", async () => {
    const event = buildEvent("LoanRequested", "user1");

    mockQuery.mockResolvedValueOnce({ rows: [1] }); // simulate duplicate

    await (indexer as any)["storeEvents"]([event]);

    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO loan_events"),
      expect.anything()
    );
  });

  // =========================
  // WEBHOOK TRIGGER
  // =========================
  it("triggers webhook dispatch", async () => {
    const event = buildEvent("LoanRequested", "user1");

    await (indexer as any)["storeEvents"]([event]);

    expect(mockDispatch).toHaveBeenCalled();
  });

  // =========================
  // TRANSACTION HANDLING
  // =========================
  it("wraps operations in transaction", async () => {
    const event = buildEvent("LoanRequested", "user1");

    await (indexer as any)["storeEvents"]([event]);

    expect(mockQuery).toHaveBeenCalledWith("BEGIN", []);
    expect(mockQuery).toHaveBeenCalledWith("COMMIT", []);
  });

  it("rolls back on failure", async () => {
    const event = buildEvent("LoanRequested", "user1");

    mockQuery.mockImplementation(() => {
      throw new Error("DB fail");
    });

    await expect((indexer as any)["storeEvents"]([event])).rejects.toThrow();

    expect(mockQuery).toHaveBeenCalledWith("ROLLBACK", []);
  });
});