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

const { WebhookService, getRetryDelayMs } = await import(
  "../services/webhookService.js"
);
const { default: logger } = await import("../utils/logger.js");

describe("WebhookService", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.clearAllMocks();
    global.fetch = originalFetch;
    delete process.env.WEBHOOK_MAX_PAYLOAD_BYTES;
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
        rows: [{ id: 1, callback_url: "https://consumer.example", secret: null }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const service = new WebhookService();
    await service.dispatch({
      eventId: "evt-123",
      eventType: "LoanApproved",
      loanId: 42,
      address: "GBORROWER123",
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
          address: "GBORROWER123",
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

  it("truncates oversized webhook payloads before delivery", async () => {
    process.env.WEBHOOK_MAX_PAYLOAD_BYTES = "200";

    const fetchMock: any = jest.fn(async () => ({
      ok: true,
      status: 200,
    }));
    global.fetch = fetchMock as typeof fetch;

    const warnSpy = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => logger as typeof logger);

    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 1, callback_url: "https://consumer.example", secret: null }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const service = new WebhookService();
    await service.dispatch({
      eventId: "evt-oversized",
      eventType: "LoanApproved",
      loanId: 42,
      address: "GBORROWER123",
      ledger: 100,
      ledgerClosedAt: new Date("2025-01-01T00:00:00.000Z"),
      txHash: "tx-oversized",
      contractId: "contract-123",
      topics: ["LoanApproved", "42"],
      value: "x".repeat(1_024),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const deliveredBody = String(fetchMock.mock.calls[0]?.[1]?.body);
    const deliveredPayload = JSON.parse(deliveredBody) as Record<string, unknown>;
    expect(deliveredPayload.truncated).toBe(true);
    expect(deliveredPayload.reason).toBe("payload_too_large");
    expect(deliveredPayload.eventId).toBe("evt-oversized");
    expect(deliveredPayload.maxPayloadBytes).toBe(200);
    expect(Number(deliveredPayload.originalPayloadBytes)).toBeGreaterThan(200);
    expect(deliveredPayload.value).toBeUndefined();

    const insertParams = mockQuery.mock.calls[1]?.[1] as unknown[];
    expect(JSON.parse(String(insertParams[5]))).toEqual(deliveredPayload);
    expect(warnSpy).toHaveBeenCalledWith(
      "Webhook payload exceeds size limit, sending summary payload",
      expect.objectContaining({
        eventId: "evt-oversized",
        eventType: "LoanApproved",
        maxPayloadBytes: 200,
      }),
    );
  });

  it("logs when a webhook payload approaches the configured size limit", async () => {
    process.env.WEBHOOK_MAX_PAYLOAD_BYTES = "512";

    const fetchMock: any = jest.fn(async () => ({
      ok: true,
      status: 200,
    }));
    global.fetch = fetchMock as typeof fetch;

    const warnSpy = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => logger as typeof logger);

    const event = {
      eventId: "evt-near-limit",
      eventType: "LoanApproved" as const,
      loanId: 42,
      address: "GBORROWER123",
      ledger: 100,
      ledgerClosedAt: new Date("2025-01-01T00:00:00.000Z"),
      txHash: "tx-near-limit",
      contractId: "contract-123",
      topics: ["LoanApproved", "42"],
      value: "",
    };

    while (Buffer.byteLength(JSON.stringify(event)) < 460) {
      event.value += "x";
    }

    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 1, callback_url: "https://consumer.example", secret: null }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const service = new WebhookService();
    await service.dispatch(event);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "Webhook payload is near size limit",
      expect.objectContaining({
        eventId: "evt-near-limit",
        eventType: "LoanApproved",
        maxPayloadBytes: 512,
      }),
    );
  });
});
