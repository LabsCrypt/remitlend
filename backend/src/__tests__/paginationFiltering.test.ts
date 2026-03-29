import request from "supertest";
import { jest } from "@jest/globals";
import { Keypair } from "@stellar/stellar-sdk";
import { generateJwtToken } from "../services/authService.js";

type MockQueryResult = { rows: unknown[]; rowCount?: number };

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-min-32-chars-long!!";
process.env.INTERNAL_API_KEY = "test-internal-key";

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();
const mockCacheGet = jest.fn<() => Promise<unknown | null>>().mockResolvedValue(null);
const mockCacheSet = jest.fn<() => Promise<void>>().mockResolvedValue();

jest.unstable_mockModule("../db/connection.js", () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
}));

jest.unstable_mockModule("../services/cacheService.js", () => ({
  cacheService: {
    get: mockCacheGet,
    set: mockCacheSet,
    delete: jest.fn(),
    invalidatePattern: jest.fn(),
    ping: jest.fn<() => Promise<"ok" | "error">>().mockResolvedValue("ok"),
    close: jest.fn(),
  },
}));

await import("../db/connection.js");
const { default: app } = await import("../app.js");

const borrower = Keypair.random().publicKey();

const authHeaders = () => ({
  Authorization: `Bearer ${generateJwtToken(borrower)}`,
});

afterEach(() => {
  jest.clearAllMocks();
  mockCacheGet.mockResolvedValue(null);
  mockCacheSet.mockResolvedValue();
});

afterAll(() => {
  delete process.env.NODE_ENV;
  delete process.env.JWT_SECRET;
  delete process.env.INTERNAL_API_KEY;
});

describe("pagination and filtering", () => {
  it("paginates and filters borrower loans with a consistent response envelope", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            loan_id: 1,
            borrower,
            principal: "100",
            approved_at: "2024-02-01T00:00:00.000Z",
            approved_ledger: 80,
            rate_bps: 1200,
            term_ledgers: 17280,
            total_repaid: "0",
            is_defaulted: "0",
          },
          {
            loan_id: 2,
            borrower,
            principal: "200",
            approved_at: "2024-02-10T00:00:00.000Z",
            approved_ledger: 90,
            rate_bps: 1200,
            term_ledgers: 17280,
            total_repaid: "0",
            is_defaulted: "0",
          },
          {
            loan_id: 3,
            borrower,
            principal: "250",
            approved_at: "2024-02-20T00:00:00.000Z",
            approved_ledger: 95,
            rate_bps: 1200,
            term_ledgers: 17280,
            total_repaid: "0",
            is_defaulted: "0",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ last_indexed_ledger: 100 }],
      });

    const response = await request(app)
      .get(
        `/api/loans/borrower/${borrower}?status=active&amount_range=150,300&date_range=2024-02-01,2024-03-01&sort=principal&limit=1&offset=1`,
      )
      .set(authHeaders());

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.total_count).toBe(2);
    expect(response.body.page_info).toEqual({
      limit: 1,
      offset: 1,
      count: 1,
      has_previous: true,
      has_next: false,
    });
    expect(response.body.data.borrower).toBe(borrower);
    expect(response.body.data.loans).toHaveLength(1);
    expect(response.body.data.loans[0].loanId).toBe(3);
    expect(response.body.data.loans[0].principal).toBe(250);
  });

  it("applies event filters and returns page_info for borrower transaction history", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            event_id: "evt_2",
            event_type: "LoanRepaid",
            loan_id: 42,
            borrower,
            amount: "250",
            ledger: 200,
            ledger_closed_at: "2024-02-15T12:00:00.000Z",
            tx_hash: "tx_2",
            created_at: "2024-02-15T12:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ count: "3" }],
      });

    const response = await request(app)
      .get(
        `/api/indexer/events/borrower/${borrower}?status=LoanRepaid&amount_range=100,500&date_range=2024-02-01,2024-03-01&sort=amount&limit=1&offset=1`,
      )
      .set(authHeaders());

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.total_count).toBe(3);
    expect(response.body.page_info).toEqual({
      limit: 1,
      offset: 1,
      count: 1,
      has_previous: true,
      has_next: true,
    });
    expect(response.body.data.borrower).toBe(borrower);
    expect(response.body.data.events[0].event_type).toBe("LoanRepaid");

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[0]?.[0]).toContain("event_type = $2");
    expect(mockQuery.mock.calls[0]?.[0]).toContain(
      "CAST(amount AS NUMERIC) BETWEEN $3 AND $4",
    );
    expect(mockQuery.mock.calls[0]?.[0]).toContain(
      "ledger_closed_at BETWEEN $5 AND $6",
    );
    expect(mockQuery.mock.calls[0]?.[0]).toContain("ORDER BY amount ASC");
  });

  it("supports paginated recent events for admin dashboards", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            event_id: "evt_9",
            event_type: "LoanDefaulted",
            loan_id: 77,
            borrower,
            amount: "900",
            ledger: 400,
            ledger_closed_at: "2024-03-02T09:00:00.000Z",
            tx_hash: "tx_9",
            created_at: "2024-03-02T09:00:00.000Z",
          },
          {
            event_id: "evt_8",
            event_type: "LoanDefaulted",
            loan_id: 76,
            borrower,
            amount: "850",
            ledger: 399,
            ledger_closed_at: "2024-03-01T09:00:00.000Z",
            tx_hash: "tx_8",
            created_at: "2024-03-01T09:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ count: "5" }],
      });

    const response = await request(app)
      .get("/api/indexer/events/recent?status=LoanDefaulted&limit=2&offset=1&sort=-amount")
      .set("x-api-key", process.env.INTERNAL_API_KEY as string);

    expect(response.status).toBe(200);
    expect(response.body.total_count).toBe(5);
    expect(response.body.page_info).toEqual({
      limit: 2,
      offset: 1,
      count: 2,
      has_previous: true,
      has_next: true,
    });
    expect(response.body.data.events).toHaveLength(2);
    expect(mockQuery.mock.calls[0]?.[0]).toContain("ORDER BY amount DESC");
  });
});
