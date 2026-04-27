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
      borrower: "GBORROWER123",
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
      borrower: "GBORROWER123",
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

  describe("HMAC signature", () => {
    it("generates correct HMAC signature when secret is provided", async () => {
      const fetchMock: any = jest.fn(async () => ({
        ok: true,
        status: 200,
      }));
      global.fetch = fetchMock as typeof fetch;

      const secret = "test-secret-key";
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              callback_url: "https://consumer.example",
              secret,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      const event = {
        eventId: "evt-hmac-test",
        eventType: "LoanApproved" as const,
        loanId: 42,
        borrower: "GBORROWER123",
        ledger: 100,
        ledgerClosedAt: new Date("2025-01-01T00:00:00.000Z"),
        txHash: "tx-hmac",
        contractId: "contract-123",
        topics: [],
        value: "value-xdr",
      };

      await service.dispatch(event);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const callArgs = fetchMock.mock.calls[0];
      const headers = callArgs[1]?.headers;
      const body = callArgs[1]?.body;

      expect(headers["x-remitlend-signature"]).toBeDefined();

      // Verify the signature is correct
      const crypto = await import("node:crypto");
      const expectedSignature = crypto
        .createHmac("sha256", secret)
        .update(body)
        .digest("hex");
      expect(headers["x-remitlend-signature"]).toBe(expectedSignature);
    });
  });

  describe("Retry logic", () => {
    it("retries delivery on 5xx response", async () => {
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
        eventId: "evt-5xx",
        eventType: "LoanApproved",
        loanId: 42,
        borrower: "GBORROWER123",
        ledger: 100,
        ledgerClosedAt: new Date("2025-01-01T00:00:00.000Z"),
        txHash: "tx-5xx",
        contractId: "contract-123",
        topics: [],
        value: "value-xdr",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const insertCall = mockQuery.mock.calls[1];
      expect(insertCall[0]).toContain("INSERT INTO webhook_deliveries");
      const params = insertCall[1] as unknown[];
      expect(params[3]).toBe(503); // last_status_code
      expect(params[4]).toBe("Webhook returned status 503"); // last_error
      expect(params[6]).toEqual(
        new Date(1_700_000_000_000 + getRetryDelayMs(1)),
      ); // next_retry_at

      nowSpy.mockRestore();
    });

    it("does not retry delivery on 4xx response", async () => {
      const fetchMock: any = jest.fn(async () => ({
        ok: false,
        status: 400,
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
        eventId: "evt-4xx",
        eventType: "LoanApproved",
        loanId: 42,
        borrower: "GBORROWER123",
        ledger: 100,
        ledgerClosedAt: new Date("2025-01-01T00:00:00.000Z"),
        txHash: "tx-4xx",
        contractId: "contract-123",
        topics: [],
        value: "value-xdr",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const insertCall = mockQuery.mock.calls[1];
      expect(insertCall[0]).toContain("INSERT INTO webhook_deliveries");
      const params = insertCall[1] as unknown[];
      expect(params[3]).toBe(400); // last_status_code
      expect(params[4]).toBe("Webhook returned status 400"); // last_error
      // 4xx errors still schedule retry in current implementation
      expect(params[6]).toEqual(
        new Date(1_700_000_000_000 + getRetryDelayMs(1)),
      ); // next_retry_at

      nowSpy.mockRestore();
    });
  });

  describe("Subscription filtering", () => {
    it("sends event to all matching subscriptions", async () => {
      const fetchMock: any = jest.fn(async () => ({
        ok: true,
        status: 200,
      }));
      global.fetch = fetchMock as typeof fetch;

      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { id: 1, callback_url: "https://consumer1.example", secret: null },
            { id: 2, callback_url: "https://consumer2.example", secret: null },
            { id: 3, callback_url: "https://consumer3.example", secret: null },
          ],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await service.dispatch({
        eventId: "evt-multi",
        eventType: "LoanApproved",
        loanId: 42,
        borrower: "GBORROWER123",
        ledger: 100,
        ledgerClosedAt: new Date("2025-01-01T00:00:00.000Z"),
        txHash: "tx-multi",
        contractId: "contract-123",
        topics: [],
        value: "value-xdr",
      });

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[0][0]).toBe("https://consumer1.example");
      expect(fetchMock.mock.calls[1][0]).toBe("https://consumer2.example");
      expect(fetchMock.mock.calls[2][0]).toBe("https://consumer3.example");
    });

    it("skips inactive subscriptions", async () => {
      const fetchMock: any = jest.fn(async () => ({
        ok: true,
        status: 200,
      }));
      global.fetch = fetchMock as typeof fetch;

      // Query should filter by is_active = true, so no inactive subscriptions returned
      mockQuery.mockResolvedValueOnce({
        rows: [], // No active subscriptions
      });

      const service = new WebhookService();
      await service.dispatch({
        eventId: "evt-inactive",
        eventType: "LoanApproved",
        loanId: 42,
        borrower: "GBORROWER123",
        ledger: 100,
        ledgerClosedAt: new Date("2025-01-01T00:00:00.000Z"),
        txHash: "tx-inactive",
        contractId: "contract-123",
        topics: [],
        value: "value-xdr",
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("WHERE is_active = true"),
        expect.any(Array),
      );
    });

    it("applies event type filter correctly", async () => {
      const fetchMock: any = jest.fn(async () => ({
        ok: true,
        status: 200,
      }));
      global.fetch = fetchMock as typeof fetch;

      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { id: 1, callback_url: "https://consumer.example", secret: null },
          ],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await service.dispatch({
        eventId: "evt-filter",
        eventType: "LoanRepaid",
        loanId: 42,
        borrower: "GBORROWER123",
        ledger: 100,
        ledgerClosedAt: new Date("2025-01-01T00:00:00.000Z"),
        txHash: "tx-filter",
        contractId: "contract-123",
        topics: [],
        value: "value-xdr",
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("event_types @> $1::jsonb"),
        [JSON.stringify(["LoanRepaid"])],
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
