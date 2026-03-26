import { EventIndexer } from "../../src/services/eventIndexer.js";
import { webhookService } from "../../src/services/webhookService.js";
import { query } from "../../src/db/connection.js";
//@ts-ignore
import { SorobanRpc } from "@stellar/stellar-sdk";

jest.mock("../../src/db/connection.js", () => ({
  query: jest.fn(),
}));

jest.mock("@stellar/stellar-sdk", () => {
  return {
    __esModule: true,
    SorobanRpc: {
      Server: jest.fn(),
    },
    scValToNative: jest.fn((val) => val),
    xdr: {
      ScVal: class {},
    },
  };
});

jest.mock("../../src/services/webhookService.js", () => {
  return {
    webhookService: {
      dispatch: jest.fn(),
    },
  };
});

const mockQuery = query as jest.Mock;
const mockDispatch = webhookService.dispatch as jest.Mock;

describe("EventIndexer Integration Tests", () => {
  let indexer: EventIndexer;
  let mockGetEvents: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetEvents = jest.fn();

    (SorobanRpc.Server as unknown as jest.Mock).mockImplementation(() => ({
      getEvents: mockGetEvents,
    }));

    indexer = new EventIndexer("http://rpc", "contract-123");
  });

  const mockScVal = (value: any) => ({
    toXDR: () => "base64",
    sym: () => ({
      toString: () => value,
    }),
  });

  const baseEvent = {
    id: "evt1",
    pagingToken: "1",
    ledger: 100,
    ledgerClosedAt: new Date().toISOString(),
    txHash: "tx1",
    contractId: "contract-123",
  };

  function buildEvent(type: string, topicExtras: any[] = [], value: any = "100") {
    return {
      ...baseEvent,
      topic: [mockScVal(type), ...topicExtras],
      value: mockScVal(value),
    };
  }

  // =========================
  // EVENT PARSING
  // =========================

  it("parses LoanRequested event", async () => {
    const event = buildEvent("LoanRequested", [mockScVal("user1")], "500");

    mockGetEvents.mockResolvedValue({ events: [event] });
    mockQuery.mockResolvedValue({ rows: [] });

    await indexer.processEvents(1, 200);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO loan_events"),
      expect.arrayContaining(["LoanRequested"])
    );
  });

  it("parses LoanApproved event", async () => {
    const event = buildEvent("LoanApproved", [mockScVal(1)]);

    mockGetEvents.mockResolvedValue({ events: [event] });
    mockQuery.mockResolvedValue({ rows: [] });

    await indexer.processEvents(1, 200);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO loan_events"),
      expect.arrayContaining(["LoanApproved"])
    );
  });

  it("parses LoanRepaid and updates score", async () => {
    const event = buildEvent(
      "LoanRepaid",
      [mockScVal("user1"), mockScVal(1)],
      "300"
    );

    mockGetEvents.mockResolvedValue({ events: [event] });
    mockQuery.mockResolvedValue({ rows: [] });

    await indexer.processEvents(1, 200);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO scores"),
      expect.any(Array)
    );
  });

  it("parses LoanDefaulted and penalizes score", async () => {
    const event = buildEvent("LoanDefaulted", [mockScVal(1)], "user1");

    mockGetEvents.mockResolvedValue({ events: [event] });
    mockQuery.mockResolvedValue({ rows: [] });

    await indexer.processEvents(1, 200);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO scores"),
      expect.any(Array)
    );
  });

  // =========================
  // DEDUPLICATION
  // =========================

  it("skips duplicate events", async () => {
    const event = buildEvent("LoanRequested", [mockScVal("user1")]);

    mockGetEvents.mockResolvedValue({ events: [event] });

    // duplicate found
    mockQuery.mockResolvedValueOnce({ rows: [1] });

    await indexer.processEvents(1, 200);

    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO loan_events"),
      expect.anything()
    );
  });

  // =========================
  // WEBHOOK TRIGGER
  // =========================

  it("triggers webhook dispatch", async () => {
    const event = buildEvent("LoanRequested", [mockScVal("user1")]);

    mockGetEvents.mockResolvedValue({ events: [event] });
    mockQuery.mockResolvedValue({ rows: [] });

    await indexer.processEvents(1, 200);

    expect(mockDispatch).toHaveBeenCalled();
  });

  // =========================
  // TRANSACTION HANDLING
  // =========================

  it("wraps operations in transaction", async () => {
    const event = buildEvent("LoanRequested", [mockScVal("user1")]);

    mockGetEvents.mockResolvedValue({ events: [event] });
    mockQuery.mockResolvedValue({ rows: [] });

    await indexer.processEvents(1, 200);

    expect(mockQuery).toHaveBeenCalledWith("BEGIN", []);
    expect(mockQuery).toHaveBeenCalledWith("COMMIT", []);
  });

  it("rolls back on failure", async () => {
    const event = buildEvent("LoanRequested", [mockScVal("user1")]);

    mockGetEvents.mockResolvedValue({ events: [event] });

    mockQuery.mockImplementation(() => {
      throw new Error("DB fail");
    });

    await expect(indexer.processEvents(1, 200)).rejects.toThrow();

    expect(mockQuery).toHaveBeenCalledWith("ROLLBACK", []);
  });
});