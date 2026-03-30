import { jest } from "@jest/globals";
import { Address, Keypair, nativeToScVal } from "@stellar/stellar-sdk";

const mockQuery = jest.fn<
  (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>
>();
const mockDispatch = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockBroadcast = jest.fn();
const mockCreateNotification = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockGetScoreConfig = jest.fn(() => ({
  repaymentDelta: 15,
  defaultPenalty: 50,
}));

jest.unstable_mockModule("../db/connection.js", () => ({
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
}));

jest.unstable_mockModule("../services/webhookService.js", () => ({
  webhookService: { dispatch: mockDispatch },
}));

jest.unstable_mockModule("../services/eventStreamService.js", () => ({
  eventStreamService: { broadcast: mockBroadcast },
}));

jest.unstable_mockModule("../services/notificationService.js", () => ({
  notificationService: { createNotification: mockCreateNotification },
}));

jest.unstable_mockModule("../services/sorobanService.js", () => ({
  sorobanService: { getScoreConfig: mockGetScoreConfig },
}));

jest.unstable_mockModule("../utils/logger.js", () => ({
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.unstable_mockModule("../utils/requestContext.js", () => ({
  createRequestId: () => "test-request",
  runWithRequestContext: async (_requestId: string, callback: () => Promise<unknown>) => callback(),
}));

const { EventIndexer } = await import("../services/eventIndexer.js");

function makeAddress() {
  return Keypair.random().publicKey();
}

function scAddress(address: string) {
  return nativeToScVal(Address.fromString(address), { type: "address" });
}

function scI128(value: number) {
  return nativeToScVal(BigInt(value), { type: "i128" });
}

function scU32(value: number) {
  return nativeToScVal(value, { type: "u32" });
}

function scSymbol(value: string) {
  return nativeToScVal(value, { type: "symbol" });
}

function makeRawEvent(params: {
  id: string;
  ledger: number;
  type: string;
  borrower?: string;
  loanId?: number;
  amount?: number;
}) {
  const borrower = params.borrower ?? makeAddress();
  const base = {
    id: params.id,
    pagingToken: `${params.ledger}`,
    ledger: params.ledger,
    ledgerClosedAt: "2026-03-29T00:00:00.000Z",
    txHash: `tx-${params.id}`,
    contractId: "CINDEXERTEST",
  };

  switch (params.type) {
    case "LoanRequested":
      return {
        ...base,
        topic: [scSymbol("LoanRequested"), scAddress(borrower)],
        value: scI128(params.amount ?? 500),
      };
    case "LoanApproved":
      return {
        ...base,
        topic: [scSymbol("LoanApproved"), scU32(params.loanId ?? 1)],
        value: scAddress(borrower),
      };
    case "LoanRepaid":
      return {
        ...base,
        topic: [scSymbol("LoanRepaid"), scAddress(borrower), scU32(params.loanId ?? 1)],
        value: scI128(params.amount ?? 250),
      };
    case "LoanDefaulted":
      return {
        ...base,
        topic: [scSymbol("LoanDefaulted"), scU32(params.loanId ?? 1)],
        value: scAddress(borrower),
      };
    default:
      throw new Error(`Unsupported event type: ${params.type}`);
  }
}

describe("EventIndexer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("parses the four core loan event types and triggers downstream side effects", async () => {
    const borrowerRequested = makeAddress();
    const borrowerApproved = makeAddress();
    const borrowerRepaid = makeAddress();
    const borrowerDefaulted = makeAddress();
    const insertedLoanEvents: unknown[][] = [];
    const scoreUpdates: unknown[][] = [];

    mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql === "BEGIN" || sql === "COMMIT") {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("INSERT INTO loan_events")) {
        insertedLoanEvents.push(params);
        return { rows: [{ event_id: params[0] }], rowCount: 1 };
      }

      if (sql.includes("INSERT INTO scores")) {
        // Handle batched updates - params come as [user1, delta1, user2, delta2, ...]
        for (let i = 0; i < params.length; i += 2) {
          scoreUpdates.push([params[i], params[i + 1]]);
        }
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    });

    const indexer = new EventIndexer({
      rpcUrl: "https://rpc.test",
      contractId: "CINDEXERTEST",
    });

    (indexer as unknown as { rpc: { getEvents: unknown } }).rpc = {
      getEvents: async () => ({
        events: [
          makeRawEvent({
            id: "evt-requested",
            ledger: 11,
            type: "LoanRequested",
            borrower: borrowerRequested,
            amount: 800,
          }),
          makeRawEvent({
            id: "evt-approved",
            ledger: 12,
            type: "LoanApproved",
            borrower: borrowerApproved,
            loanId: 7,
          }),
          makeRawEvent({
            id: "evt-repaid",
            ledger: 13,
            type: "LoanRepaid",
            borrower: borrowerRepaid,
            loanId: 8,
            amount: 220,
          }),
          makeRawEvent({
            id: "evt-defaulted",
            ledger: 14,
            type: "LoanDefaulted",
            borrower: borrowerDefaulted,
            loanId: 9,
          }),
        ],
      }),
    };

    const lastProcessedLedger = await indexer.processEvents(11, 14);

    expect(lastProcessedLedger).toBe(14);
    expect(insertedLoanEvents).toHaveLength(4);
    expect(insertedLoanEvents.map((params) => params[1])).toEqual([
      "LoanRequested",
      "LoanApproved",
      "LoanRepaid",
      "LoanDefaulted",
    ]);
    expect(insertedLoanEvents[0]?.[3]).toBe(borrowerRequested);
    expect(insertedLoanEvents[0]?.[4]).toBe("800");
    expect(insertedLoanEvents[1]?.[2]).toBe(7);
    expect(insertedLoanEvents[1]?.[3]).toBe(borrowerApproved);
    expect(insertedLoanEvents[1]?.[11]).toBe(1200);
    expect(insertedLoanEvents[1]?.[12]).toBe(17280);
    expect(insertedLoanEvents[2]?.[2]).toBe(8);
    expect(insertedLoanEvents[2]?.[4]).toBe("220");
    expect(insertedLoanEvents[3]?.[2]).toBe(9);
    expect(insertedLoanEvents[3]?.[3]).toBe(borrowerDefaulted);

    expect(scoreUpdates).toEqual([[borrowerRepaid, 15, borrowerDefaulted, -50]]);
    expect(mockGetScoreConfig).toHaveBeenCalledTimes(2);
    expect(mockDispatch).toHaveBeenCalledTimes(4);
    expect(mockBroadcast).toHaveBeenCalledTimes(4);
    expect(mockCreateNotification).toHaveBeenCalledTimes(3);
  });

  it("deduplicates repeated events and only triggers side effects for inserted rows", async () => {
    const borrower = makeAddress();
    let insertCount = 0;

    mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql === "BEGIN" || sql === "COMMIT") {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("INSERT INTO loan_events")) {
        insertCount += 1;
        const inserted = insertCount === 1;
        return {
          rows: inserted ? [{ event_id: params[0] }] : [],
          rowCount: inserted ? 1 : 0,
        };
      }

      if (sql.includes("INSERT INTO scores")) {
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    });

    const duplicateEvent = makeRawEvent({
      id: "evt-duplicate",
      ledger: 20,
      type: "LoanRepaid",
      borrower,
      loanId: 55,
      amount: 300,
    });

    const indexer = new EventIndexer({
      rpcUrl: "https://rpc.test",
      contractId: "CINDEXERTEST",
    });

    (indexer as unknown as { rpc: { getEvents: unknown } }).rpc = {
      getEvents: async () => ({
        events: [duplicateEvent, duplicateEvent],
      }),
    };

    await indexer.processEvents(20, 20);

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockBroadcast).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockGetScoreConfig).toHaveBeenCalledTimes(1);
  });

  it("initializes missing indexer state and persists the last indexed ledger during polling", async () => {
    const stateWrites: number[] = [];

    mockQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("SELECT last_indexed_ledger")) {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("INSERT INTO indexer_state")) {
        stateWrites.push(Number(params[0] ?? 0));
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("UPDATE indexer_state")) {
        stateWrites.push(Number(params[0]));
        return { rows: [], rowCount: 1 };
      }

      if (sql === "BEGIN" || sql === "COMMIT") {
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes("INSERT INTO loan_events")) {
        return { rows: [{ event_id: params[0] }], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    });

    const indexer = new EventIndexer({
      rpcUrl: "https://rpc.test",
      contractId: "CINDEXERTEST",
    });

    (indexer as unknown as { running: boolean }).running = true;
    (indexer as unknown as {
      rpc: {
        getLatestLedger: unknown;
        getEvents: unknown;
      };
    }).rpc = {
      getLatestLedger: async () => ({ sequence: 15 }),
      getEvents: async () => ({
        events: [makeRawEvent({ id: "evt-poll", ledger: 15, type: "LoanRequested" })],
      }),
    };

    await (indexer as unknown as { pollOnce: () => Promise<void> }).pollOnce();

    expect(stateWrites).toEqual([0, 15]);
  });
});
