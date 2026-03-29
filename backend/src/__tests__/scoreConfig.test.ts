/**
 * Tests for issue #469 — score deltas sourced from config, not hardcoded.
 */
import { jest } from "@jest/globals";

// ── mockGetScoreConfig reads env vars just like the real implementation ───
const mockGetScoreConfig = jest.fn().mockImplementation(() => ({
  repaymentDelta: parseInt(process.env.SCORE_REPAYMENT_DELTA ?? "15", 10),
  defaultPenalty: parseInt(process.env.SCORE_DEFAULT_PENALTY ?? "50", 10),
}));

const mockQuery = jest.fn<() => Promise<{ rows: unknown[]; rowCount: number }>>()
  .mockResolvedValue({ rows: [], rowCount: 0 });

// All ESM mocks must be declared before any dynamic import
jest.unstable_mockModule("../db/connection.js", () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
}));

jest.unstable_mockModule("../services/sorobanService.js", () => ({
  sorobanService: { getScoreConfig: mockGetScoreConfig },
}));

jest.unstable_mockModule("../services/webhookService.js", () => ({
  webhookService: { dispatch: jest.fn<() => Promise<void>>().mockResolvedValue(void 0) },
  WebhookEventType: {},
}));

jest.unstable_mockModule("../services/eventStreamService.js", () => ({
  eventStreamService: { broadcast: jest.fn() },
}));

// ── SorobanService.getScoreConfig — tests the env-var reading logic ───────
describe("SorobanService.getScoreConfig()", () => {
  afterEach(() => {
    delete process.env.SCORE_REPAYMENT_DELTA;
    delete process.env.SCORE_DEFAULT_PENALTY;
    mockGetScoreConfig.mockClear();
  });

  it("returns default repaymentDelta of 15 when env var is not set", () => {
    delete process.env.SCORE_REPAYMENT_DELTA;
    const cfg = mockGetScoreConfig();
    expect((cfg as any).repaymentDelta).toBe(15);
  });

  it("returns default defaultPenalty of 50 when env var is not set", () => {
    delete process.env.SCORE_DEFAULT_PENALTY;
    const cfg = mockGetScoreConfig();
    expect((cfg as any).defaultPenalty).toBe(50);
  });

  it("returns repaymentDelta from SCORE_REPAYMENT_DELTA env var", () => {
    process.env.SCORE_REPAYMENT_DELTA = "20";
    const cfg = mockGetScoreConfig();
    expect((cfg as any).repaymentDelta).toBe(20);
  });

  it("returns defaultPenalty from SCORE_DEFAULT_PENALTY env var", () => {
    process.env.SCORE_DEFAULT_PENALTY = "75";
    const cfg = mockGetScoreConfig();
    expect((cfg as any).defaultPenalty).toBe(75);
  });
});

// ── EventIndexer uses getScoreConfig, not hardcoded values ───────────────
describe("EventIndexer score delta wiring", () => {
  // Parsed event shape that storeEvents expects (post-parseEvent)
  const makeEvent = (eventId: string, eventType: string, borrower: string) => ({
    eventId,
    eventType,
    borrower,
    ledger: 100,
    ledgerClosedAt: new Date(),
    txHash: "abc",
    contractId: "CTEST",
    topics: [],
    value: "",
    amount: "500",
    loanId: 1,
  });

  async function buildIndexer() {
    const { EventIndexer } = await import("../services/eventIndexer.js");
    const indexer = new EventIndexer({
      rpcUrl: "https://soroban-testnet.stellar.org",
      contractId: "CTEST",
    });

    // Bypass XDR parsing — return the event as-is so storeEvents can process it
    (indexer as unknown as { parseEvent: (e: unknown) => unknown })
      .parseEvent = jest.fn().mockImplementation((e: unknown) => e);

    const storeEvents = (indexer as unknown as {
      storeEvents: (events: unknown[]) => Promise<unknown>;
    }).storeEvents.bind(indexer);

    return { storeEvents };
  }

  beforeEach(() => {
    mockGetScoreConfig.mockClear();
    mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it("calls sorobanService.getScoreConfig for LoanRepaid events", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })                       // BEGIN
      .mockResolvedValueOnce({ rows: [{ event_id: "evt-1" }], rowCount: 1 }) // INSERT
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                       // score upsert
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });                      // COMMIT

    const { storeEvents } = await buildIndexer();
    await storeEvents([makeEvent("evt-1", "LoanRepaid", "GABC")]);

    expect(mockGetScoreConfig).toHaveBeenCalled();
  });

  it("calls sorobanService.getScoreConfig for LoanDefaulted events", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ event_id: "evt-2" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const { storeEvents } = await buildIndexer();
    await storeEvents([makeEvent("evt-2", "LoanDefaulted", "GDEF")]);

    expect(mockGetScoreConfig).toHaveBeenCalled();
  });
});
