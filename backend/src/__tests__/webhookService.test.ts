import { jest } from "@jest/globals";

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

jest.unstable_mockModule("../db/connection.js", () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
}));

const { WebhookService, getRetryDelayMs } =
  await import("../services/webhookService.js");

describe("WebhookService", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.clearAllMocks();
    global.fetch = originalFetch;
  });

  it("returns the expected retry delays", () => {
    expect(getRetryDelayMs(1)).toBe(5 * 60 * 1000);
    expect(getRetryDelayMs(2)).toBe(15 * 60 * 1000);
    expect(getRetryDelayMs(3)).toBe(45 * 60 * 1000);
    expect(getRetryDelayMs(4)).toBe(45 * 60 * 1000);
  });

  it("persists retry state when the initial delivery fails", async () => {
    const fetchMock: any = jest.fn(async () => ({
      ok: false,
      status: 503,
    }));
    global.fetch = fetchMock as typeof fetch;

    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { id: 1, callback_url: "https://consumer.example", secret: null },
        ],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const service = new WebhookService();
    await service.dispatch({
      eventId: "evt-123",
      eventType: "LoanApproved",
      loanId: 42,
      borrower: "GBORROWER123",
      ledger: 100,
      ledgerClosedAt: new Date("2025-01-01T00:00:00.000Z"),
      txHash: "tx-123",
      contractId: "contract-123",
      topics: [],
      value: "value-xdr",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("FROM webhook_subscriptions"),
      [JSON.stringify(["LoanApproved"])],
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO webhook_deliveries"),
      [
        1,
        "evt-123",
        "LoanApproved",
        503,
        "Webhook returned status 503",
        JSON.stringify({
          eventId: "evt-123",
          eventType: "LoanApproved",
          loanId: 42,
          borrower: "GBORROWER123",
          ledger: 100,
          ledgerClosedAt: "2025-01-01T00:00:00.000Z",
          txHash: "tx-123",
          contractId: "contract-123",
          topics: [],
          value: "value-xdr",
        }),
        new Date(1_700_000_000_000 + getRetryDelayMs(1)),
      ],
    );

    nowSpy.mockRestore();
  });
});
