/**
 * Tests for EventIndexer transaction atomicity.
 *
 * These tests verify that:
 *  1. Event insert + score update commit atomically (happy path)
 *  2. A score-update failure causes the entire operation to throw (rollback)
 *  3. An event-insert failure causes the operation to throw before score updates run
 *  4. Duplicate events (ON CONFLICT DO NOTHING) do not trigger score updates
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from "@jest/globals";

// --------------------------------------------------------------------------
// Mock declarations
// --------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockWithTransaction: jest.Mock<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockUpdateUserScoresBulk: jest.Mock<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockSorobanGetScoreConfig: jest.Mock<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockWebhookDispatch: jest.Mock<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockEventStreamBroadcast: jest.Mock<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockNotificationCreate: jest.Mock<any>;

type TxCallback = (client: MockClient) => Promise<unknown>;

interface MockClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: jest.Mock<any>;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Build a raw Soroban event that parses as LoanRepaid with borrower="addr" */
function makeRawRepaidEvent(id = "event-001"): Record<string, unknown> {
  const makeSym = (name: string) => ({
    sym: () => ({ toString: () => name }),
    toXDR: (_enc: string) => `xdr:${name}`,
  });

  return {
    id,
    pagingToken: id,
    topic: [
      makeSym("LoanRepaid"),
      { sym: () => ({ toString: () => "addr" }), toXDR: () => "xdr:addr" },
      { sym: () => ({ toString: () => "1" }), toXDR: () => "xdr:1" },
    ],
    value: {
      _val: 1000n,
      sym: () => {
        throw new Error("not a sym");
      },
      toXDR: () => "xdr:val",
    },
    ledger: 100,
    ledgerClosedAt: new Date().toISOString(),
    txHash: "txhash001",
    contractId: { toString: () => "CONTRACT001" },
  };
}

/** Run the withTransaction callback immediately using the provided mock client. */
function stubWithTransaction(mockClient: MockClient): void {
  mockWithTransaction.mockImplementation(async (fn: TxCallback) =>
    fn(mockClient),
  );
}

// --------------------------------------------------------------------------
// Module setup
// --------------------------------------------------------------------------

let EventIndexer: any;

beforeAll(async () => {
  mockWithTransaction = jest.fn<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  mockUpdateUserScoresBulk = jest.fn<any>().mockResolvedValue(undefined); // eslint-disable-line @typescript-eslint/no-explicit-any
  mockSorobanGetScoreConfig = jest
    .fn<any>() // eslint-disable-line @typescript-eslint/no-explicit-any
    .mockReturnValue({ repaymentDelta: 10, defaultPenalty: 20 });
  mockWebhookDispatch = jest.fn<any>().mockResolvedValue(undefined); // eslint-disable-line @typescript-eslint/no-explicit-any
  mockEventStreamBroadcast = jest.fn<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  mockNotificationCreate = jest.fn<any>().mockResolvedValue(undefined); // eslint-disable-line @typescript-eslint/no-explicit-any

  jest.unstable_mockModule("../../db/connection.js", () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: jest.fn<any>().mockResolvedValue({ rows: [], rowCount: 0 }),
    getClient: jest.fn(),
    withTransaction: mockWithTransaction,
    TRANSIENT_ERROR_CODES: new Set(["08006", "57P01", "40001"]),
  }));

  jest.unstable_mockModule("../scoresService.js", () => ({
    updateUserScoresBulk: mockUpdateUserScoresBulk,
  }));

  jest.unstable_mockModule("../sorobanService.js", () => ({
    sorobanService: { getScoreConfig: mockSorobanGetScoreConfig },
  }));

  jest.unstable_mockModule("../webhookService.js", () => ({
    webhookService: { dispatch: mockWebhookDispatch },
    IndexedLoanEvent: {},
    WebhookEventType: {},
    SUPPORTED_WEBHOOK_EVENT_TYPES: [
      "LoanRequested",
      "LoanApproved",
      "LoanRepaid",
      "LoanDefaulted",
      "CollateralLiquidated",
      "Deposit",
      "Withdraw",
      "YieldDistributed",
      "EmergencyWithdraw",
      "NFTMinted",
      "ScoreUpdated",
      "NFTSeized",
      "NFTBurned",
      "ProposalCreated",
      "ProposalApproved",
      "ProposalFinalized",
      "Mint",
      "ScoreUpd",
      "Seized",
      "GovProp",
      "GovAppr",
      "GovFin",
      "Transfer",
      "MntAuth",
      "MntRev",
      "Paused",
      "Unpaused",
      "MinScoreUpdated",
      "PoolPaused",
      "PoolUnpaused",
    ],
  }));

  jest.unstable_mockModule("../eventStreamService.js", () => ({
    eventStreamService: { broadcast: mockEventStreamBroadcast },
  }));

  jest.unstable_mockModule("../notificationService.js", () => ({
    notificationService: { createNotification: mockNotificationCreate },
  }));

  jest.unstable_mockModule("../../utils/logger.js", () => ({
    default: {
      warn: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    },
  }));

  jest.unstable_mockModule("../../utils/requestContext.js", () => ({
    createRequestId: jest.fn().mockReturnValue("test-req-id"),
    runWithRequestContext: jest.fn((_id: string, fn: () => Promise<unknown>) =>
      fn(),
    ),
  }));

  jest.unstable_mockModule("@stellar/stellar-sdk", () => ({
    rpc: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Server: jest.fn<any>().mockImplementation(() => ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getEvents: jest.fn<any>().mockResolvedValue({ events: [] }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getLatestLedger: jest.fn<any>().mockResolvedValue({ sequence: 0 }),
      })),
    },
    scValToNative: jest.fn((val: any) => {
      if (val?._val !== undefined) return val._val;
      return val?.sym?.()?.toString?.() ?? "";
    }),
    xdr: { ScVal: {} },
  }));

  jest.unstable_mockModule("../../errors/AppError.js", () => ({
    AppError: { badRequest: (msg: string) => new Error(msg) },
  }));

  const mod = await import("../eventIndexer.js");
  EventIndexer = (mod as any).EventIndexer;
});

beforeEach(() => {
  jest.clearAllMocks();
  // Restore default score config after each test
  mockSorobanGetScoreConfig.mockReturnValue({
    repaymentDelta: 10,
    defaultPenalty: 20,
  });
  mockUpdateUserScoresBulk.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function makeIndexer() {
  return new EventIndexer({
    rpcUrl: "http://localhost:8000",
    contractIds: ["CONTRACT001"],
  });
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("EventIndexer – transaction atomicity via ingestRawEvents", () => {
  it("happy path: event insert succeeds and score update is called with the pinned client", async () => {
    const mockClient: MockClient = {
      query: jest.fn<any>().mockResolvedValue({
        rowCount: 1,
        rows: [{ event_id: "event-001" }],
      }),
    };
    stubWithTransaction(mockClient);

    const result = await makeIndexer().ingestRawEvents([
      makeRawRepaidEvent("event-001"),
    ]);

    // withTransaction must have been called once
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);

    // insertedCount reflects the new row
    expect(result.insertedCount).toBe(1);

    // Score update called exactly once, with the pinned client
    expect(mockUpdateUserScoresBulk).toHaveBeenCalledTimes(1);
    const [updates, passedClient] = mockUpdateUserScoresBulk.mock.calls[0] as [
      Map<string, number>,
      MockClient,
    ];
    expect(passedClient).toBe(mockClient);
    // LoanRepaid for borrower "addr" with repaymentDelta 10
    expect([...updates.entries()]).toEqual([["addr", 10]]);
  });

  it("score update failure propagates — the whole operation throws", async () => {
    const mockClient: MockClient = {
      query: jest.fn<any>().mockResolvedValue({
        rowCount: 1,
        rows: [{ event_id: "event-rollback" }],
      }),
    };
    // withTransaction executes the callback but re-throws when it throws
    mockWithTransaction.mockImplementation(async (fn: TxCallback) => {
      try {
        return await fn(mockClient);
      } catch (err) {
        throw err; // simulate rollback + re-throw
      }
    });
    mockUpdateUserScoresBulk.mockRejectedValueOnce(new Error("score db fail"));

    await expect(
      makeIndexer().ingestRawEvents([makeRawRepaidEvent("event-rollback")]),
    ).rejects.toThrow("score db fail");

    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
  });

  it("event INSERT failure propagates before score update runs", async () => {
    const insertError = Object.assign(new Error("insert constraint violated"), {
      code: "23505",
    });
    const mockClient: MockClient = {
      query: jest.fn<any>().mockRejectedValueOnce(insertError), // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    mockWithTransaction.mockImplementation(async (fn: TxCallback) => {
      try {
        return await fn(mockClient);
      } catch (err) {
        throw err;
      }
    });

    await expect(
      makeIndexer().ingestRawEvents([makeRawRepaidEvent("event-insert-fail")]),
    ).rejects.toThrow("insert constraint violated");

    // Score update must not have been reached
    expect(mockUpdateUserScoresBulk).not.toHaveBeenCalled();
  });

  it("duplicate event (ON CONFLICT DO NOTHING) → rowCount=0 → no score update", async () => {
    const mockClient: MockClient = {
      query: jest.fn<any>().mockResolvedValue({ rowCount: 0, rows: [] }),
    };
    stubWithTransaction(mockClient);

    const result = await makeIndexer().ingestRawEvents([
      makeRawRepaidEvent("dup-event"),
    ]);

    expect(result.insertedCount).toBe(0);
    expect(mockUpdateUserScoresBulk).not.toHaveBeenCalled();
  });

  it("aggregates score deltas for multiple events in a single bulk call", async () => {
    // Two LoanRepaid events for the same borrower should sum their deltas
    const event1 = makeRawRepaidEvent("evt-a");
    const event2 = makeRawRepaidEvent("evt-b");

    let callCount = 0;
    const mockClient: MockClient = {
      query: jest.fn().mockImplementation(async () => {
        callCount++;
        return { rowCount: 1, rows: [{ event_id: `evt-${callCount}` }] };
      }),
    };
    stubWithTransaction(mockClient);

    await makeIndexer().ingestRawEvents([event1, event2]);

    // Should be called once (bulk) not twice
    expect(mockUpdateUserScoresBulk).toHaveBeenCalledTimes(1);
    const [updates] = mockUpdateUserScoresBulk.mock.calls[0] as [
      Map<string, number>,
    ];
    // repaymentDelta: 10, two events → 20
    expect(updates.get("addr")).toBe(20);
  });

  it("withTransaction is called — not the legacy query('BEGIN') approach", async () => {
    const mockQuery = (await import("../../db/connection.js"))
      .query as jest.Mock;

    const mockClient: MockClient = {
      query: jest.fn<any>().mockResolvedValue({ rowCount: 0, rows: [] }),
    };
    stubWithTransaction(mockClient);

    await makeIndexer().ingestRawEvents([makeRawRepaidEvent()]);

    // The pool-level query() should NOT have been called with 'BEGIN'
    const beginCalls = mockQuery.mock.calls.filter(([sql]) => sql === "BEGIN");
    expect(beginCalls).toHaveLength(0);

    // withTransaction is the entry point instead
    expect(mockWithTransaction).toHaveBeenCalledTimes(1);
  });
});
