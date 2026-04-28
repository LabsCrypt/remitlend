import { jest } from "@jest/globals";
import { Address, Keypair, nativeToScVal } from "@stellar/stellar-sdk";

const mockQuery =
  jest.fn<
    (
      sql: string,
      params?: unknown[],
    ) => Promise<{ rows: unknown[]; rowCount: number }>
  >();
const mockDispatch = jest
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);
const mockBroadcast = jest.fn();
const mockCreateNotification = jest
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);
const mockGetScoreConfig = jest.fn(() => ({
  repaymentDelta: 15,
  defaultPenalty: 50,
}));
const mockUpdateUserScoresBulk = jest
  .fn<(updates: Map<string, number>) => Promise<void>>()
  .mockResolvedValue(undefined);
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
const supportedWebhookEventTypes = [
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
] as const;

jest.unstable_mockModule("../db/connection.js", () => ({
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(
    async (
      fn: (client: {
        query: typeof mockQuery;
        release: () => void;
      }) => Promise<unknown>,
    ) => {
      // Provide a mock client whose .query() delegates to the shared mockQuery
      // so all existing SQL-inspection assertions in the tests keep working.
      const mockClient = {
        query: jest.fn(async (sql: string, params?: unknown[]) =>
          mockQuery(sql, params ?? []),
        ),
        release: jest.fn(),
      };
      return fn(mockClient);
    },
  ),
}));

jest.unstable_mockModule("../services/webhookService.js", () => ({
  SUPPORTED_WEBHOOK_EVENT_TYPES: supportedWebhookEventTypes,
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

jest.unstable_mockModule("../services/scoresService.js", () => ({
  updateUserScoresBulk: mockUpdateUserScoresBulk,
}));

jest.unstable_mockModule("../utils/logger.js", () => ({
  default: mockLogger,
}));

jest.unstable_mockModule("../utils/requestContext.js", () => ({
  createRequestId: () => "test-request",
  runWithRequestContext: async (
    _requestId: string,
    callback: () => Promise<unknown>,
  ) => callback(),
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
        topic: [
          scSymbol("LoanApproved"),
          scU32(params.loanId ?? 1),
          scAddress(borrower),
        ],
        value: nativeToScVal([1200, 17280]),
      };
    case "LoanRepaid":
      return {
        ...base,
        topic: [
          scSymbol("LoanRepaid"),
          scAddress(borrower),
          scU32(params.loanId ?? 1),
        ],
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

function makeAliasedEvent(params: {
  id: string;
  ledger: number;
  rawType: string;
  borrower?: string;
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

  if (params.rawType === "Deposit" || params.rawType === "EmergencyWithdraw") {
    return {
      ...base,
      topic: [
        scSymbol(params.rawType),
        scAddress(borrower),
        scAddress(makeAddress()),
      ],
      value: nativeToScVal([BigInt(params.amount ?? 100), BigInt(1)]),
    };
  }

  if (
    params.rawType === "Mint" ||
    params.rawType === "ScoreUpd" ||
    params.rawType === "NftBurned" ||
    params.rawType === "Seized"
  ) {
    return {
      ...base,
      topic: [scSymbol(params.rawType), scAddress(borrower)],
      value: scI128(params.amount ?? 100),
    };
  }

  if (
    params.rawType === "GovProp" ||
    params.rawType === "GovAppr" ||
    params.rawType === "GovFin"
  ) {
    return {
      ...base,
      topic: [scSymbol(params.rawType), scAddress(borrower)],
      value: scU32(1),
    };
  }

  throw new Error(`Unsupported aliased event type: ${params.rawType}`);
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

    mockQuery.mockImplementation(
      async (sql: string, params: unknown[] = []) => {
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
      },
    );

    mockUpdateUserScoresBulk.mockImplementation(
      async (updates: Map<string, number>) => {
        for (const [userId, delta] of updates) {
          scoreUpdates.push([userId, delta]);
        }
      },
    );

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

    expect(scoreUpdates).toEqual([
      [borrowerRepaid, 15],
      [borrowerDefaulted, -50],
    ]);
    expect(mockGetScoreConfig).toHaveBeenCalledTimes(2);
    expect(mockDispatch).toHaveBeenCalledTimes(4);
    expect(mockBroadcast).toHaveBeenCalledTimes(4);
    expect(mockCreateNotification).toHaveBeenCalledTimes(3);
  });

  it("normalizes pool, NFT, and governance events into indexable event types", async () => {
    const depositor = makeAddress();
    const emergencyWithdrawer = makeAddress();
    const nftUser = makeAddress();
    const governanceActor = makeAddress();
    const insertedLoanEvents: unknown[][] = [];

    mockQuery.mockImplementation(
      async (sql: string, params: unknown[] = []) => {
        if (sql === "BEGIN" || sql === "COMMIT") {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("INSERT INTO loan_events")) {
          insertedLoanEvents.push(params);
          return { rows: [{ event_id: params[0] }], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      },
    );

    const indexer = new EventIndexer({
      rpcUrl: "https://rpc.test",
      contractId: "CINDEXERTEST",
    });

    (indexer as unknown as { rpc: { getEvents: unknown } }).rpc = {
      getEvents: async () => ({
        events: [
          makeAliasedEvent({
            id: "evt-deposit",
            ledger: 50,
            rawType: "Deposit",
            borrower: depositor,
            amount: 700,
          }),
          makeAliasedEvent({
            id: "evt-emergency-withdraw",
            ledger: 51,
            rawType: "EmergencyWithdraw",
            borrower: emergencyWithdrawer,
            amount: 300,
          }),
          makeAliasedEvent({
            id: "evt-score",
            ledger: 52,
            rawType: "ScoreUpd",
            borrower: nftUser,
            amount: 640,
          }),
          makeAliasedEvent({
            id: "evt-seized",
            ledger: 53,
            rawType: "Seized",
            borrower: nftUser,
          }),
          makeAliasedEvent({
            id: "evt-burned",
            ledger: 54,
            rawType: "NftBurned",
            borrower: nftUser,
          }),
          makeAliasedEvent({
            id: "evt-gov-created",
            ledger: 55,
            rawType: "GovProp",
            borrower: governanceActor,
          }),
          makeAliasedEvent({
            id: "evt-gov-approved",
            ledger: 56,
            rawType: "GovAppr",
            borrower: governanceActor,
          }),
          makeAliasedEvent({
            id: "evt-gov-finalized",
            ledger: 57,
            rawType: "GovFin",
            borrower: governanceActor,
          }),
          makeAliasedEvent({
            id: "evt-minted",
            ledger: 58,
            rawType: "Mint",
            borrower: nftUser,
            amount: 500,
          }),
        ],
      }),
    };

    const lastProcessedLedger = await indexer.processEvents(50, 58);

    expect(lastProcessedLedger).toBe(58);
    expect(insertedLoanEvents.map((params) => params[1])).toEqual([
      "Deposit",
      "EmergencyWithdraw",
      "ScoreUpdated",
      "NFTSeized",
      "NFTBurned",
      "ProposalCreated",
      "ProposalApproved",
      "ProposalFinalized",
      "NFTMinted",
    ]);
    expect(insertedLoanEvents[0]?.[3]).toBe(depositor);
    expect(insertedLoanEvents[0]?.[4]).toBe("700");
    expect(insertedLoanEvents[1]?.[3]).toBe(emergencyWithdrawer);
    expect(insertedLoanEvents[1]?.[4]).toBe("300");
    expect(insertedLoanEvents[2]?.[3]).toBe(nftUser);
    expect(insertedLoanEvents[2]?.[4]).toBe("640");
    expect(insertedLoanEvents[5]?.[3]).toBe(governanceActor);
    expect(insertedLoanEvents[8]?.[3]).toBe(nftUser);
    expect(insertedLoanEvents[8]?.[4]).toBe("500");

    expect(mockDispatch).toHaveBeenCalledTimes(9);
    expect(mockBroadcast).toHaveBeenCalledTimes(9);
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("deduplicates repeated events and only triggers side effects for inserted rows", async () => {
    const borrower = makeAddress();
    let insertCount = 0;
    const insertStatements: string[] = [];

    mockQuery.mockImplementation(
      async (sql: string, params: unknown[] = []) => {
        if (sql === "BEGIN" || sql === "COMMIT") {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("INSERT INTO loan_events")) {
          insertStatements.push(sql);
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
      },
    );

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
    expect(insertStatements[0]).toContain("ON CONFLICT (event_id) DO NOTHING");
  });

  it("ignores duplicate LoanApproved rows for the same loan and emits side effects once", async () => {
    const borrower = makeAddress();
    let approvedInsertCount = 0;

    mockQuery.mockImplementation(
      async (sql: string, params: unknown[] = []) => {
        if (sql === "BEGIN" || sql === "COMMIT") {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("INSERT INTO loan_events")) {
          if (params[1] === "LoanApproved" && params[2] === 42) {
            approvedInsertCount += 1;
            const inserted = approvedInsertCount === 1;
            return {
              rows: inserted ? [{ event_id: params[0] }] : [],
              rowCount: inserted ? 1 : 0,
            };
          }

          return { rows: [{ event_id: params[0] }], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      },
    );

    const indexer = new EventIndexer({
      rpcUrl: "https://rpc.test",
      contractId: "CINDEXERTEST",
    });

    (indexer as unknown as { rpc: { getEvents: unknown } }).rpc = {
      getEvents: async () => ({
        events: [
          makeRawEvent({
            id: "evt-approved-001",
            ledger: 31,
            type: "LoanApproved",
            borrower,
            loanId: 42,
          }),
          makeRawEvent({
            id: "evt-approved-002",
            ledger: 32,
            type: "LoanApproved",
            borrower,
            loanId: 42,
          }),
        ],
      }),
    };

    await indexer.processEvents(31, 32);

    expect(approvedInsertCount).toBe(2);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockBroadcast).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockGetScoreConfig).not.toHaveBeenCalled();
  });

  it("initializes missing indexer state and persists the last indexed ledger during polling", async () => {
    const stateWrites: number[] = [];

    mockQuery.mockImplementation(
      async (sql: string, params: unknown[] = []) => {
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
      },
    );

    const indexer = new EventIndexer({
      rpcUrl: "https://rpc.test",
      contractId: "CINDEXERTEST",
    });

    (indexer as unknown as { running: boolean }).running = true;
    (
      indexer as unknown as {
        rpc: {
          getLatestLedger: unknown;
          getEvents: unknown;
        };
      }
    ).rpc = {
      getLatestLedger: async () => ({ sequence: 15 }),
      getEvents: async () => ({
        events: [
          makeRawEvent({ id: "evt-poll", ledger: 15, type: "LoanRequested" }),
        ],
      }),
    };

    await (indexer as unknown as { pollOnce: () => Promise<void> }).pollOnce();

    expect(stateWrites).toEqual([0, 15]);
  });

  it("quarantines parse failures and emits growth alert logs", async () => {
    const previousThreshold = process.env.QUARANTINE_ALERT_THRESHOLD;
    process.env.QUARANTINE_ALERT_THRESHOLD = "2";

    mockQuery.mockImplementation(
      async (sql: string, params: unknown[] = []) => {
        if (sql.includes("INSERT INTO quarantine_events")) {
          return { rows: [], rowCount: 1 };
        }

        if (
          sql.includes("SELECT COUNT(*)::int AS count FROM quarantine_events")
        ) {
          return { rows: [{ count: 2 }], rowCount: 1 };
        }

        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("INSERT INTO loan_events")) {
          return { rows: [], rowCount: 0 };
        }

        return { rows: [], rowCount: 0 };
      },
    );

    const indexer = new EventIndexer({
      rpcUrl: "https://rpc.test",
      contractId: "CINDEXERTEST",
    });

    const malformed = {
      ...makeRawEvent({
        id: "evt-malformed",
        ledger: 42,
        type: "LoanRequested",
      }),
      value: scSymbol("invalid-amount"),
    };

    (indexer as unknown as { rpc: { getEvents: unknown } }).rpc = {
      getEvents: async () => ({
        events: [malformed],
      }),
    };

    await indexer.processEvents(42, 42);

    expect(
      mockQuery.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO quarantine_events"),
      ),
    ).toBe(true);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "Quarantine event count increased",
      expect.objectContaining({
        totalCount: 2,
      }),
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      "Quarantine event count exceeded alert threshold",
      expect.objectContaining({
        threshold: 2,
        totalCount: 2,
      }),
    );

    if (previousThreshold === undefined) {
      delete process.env.QUARANTINE_ALERT_THRESHOLD;
    } else {
      process.env.QUARANTINE_ALERT_THRESHOLD = previousThreshold;
    }
  });
});
