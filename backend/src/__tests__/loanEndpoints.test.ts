import request from "supertest";
import { jest } from "@jest/globals";
import { generateJwtToken } from "../services/authService.js";

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const VALID_API_KEY = "test-internal-key";

process.env.JWT_SECRET = "test-jwt-secret-min-32-chars-long!!";
process.env.INTERNAL_API_KEY = VALID_API_KEY;

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

// Create mock client for transaction support
const mockRelease = jest.fn();
const mockClient = {
  query: mockQuery,
  release: mockRelease,
};

jest.unstable_mockModule("../db/connection.js", () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn().mockResolvedValue(mockClient),
  closePool: jest.fn(),
}));

// Mock CacheService to prevent Redis connections
jest.unstable_mockModule("../services/cacheService.js", () => ({
  cacheService: {
    get: jest.fn<() => Promise<any>>().mockResolvedValue(null),
    set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ping: jest.fn<() => Promise<string>>().mockResolvedValue("ok"),
  },
}));

// Mock sorobanService to avoid real Stellar RPC calls
const mockBuildRequestLoanTx =
  jest.fn<
    (
      borrowerPublicKey: string,
      amount: number,
    ) => Promise<{ unsignedTxXdr: string; networkPassphrase: string }>
  >();
const mockBuildRepayTx =
  jest.fn<
    (
      borrowerPublicKey: string,
      loanId: number,
      amount: number,
    ) => Promise<{ unsignedTxXdr: string; networkPassphrase: string }>
  >();
const mockSubmitSignedTx =
  jest.fn<
    (
      signedTxXdr: string,
    ) => Promise<{ txHash: string; status: string; resultXdr?: string }>
  >();
jest.unstable_mockModule("../services/sorobanService.js", () => ({
  sorobanService: {
    buildRequestLoanTx: mockBuildRequestLoanTx,
    buildRepayTx: mockBuildRepayTx,
    submitSignedTx: mockSubmitSignedTx,
  },
}));

await import("../db/connection.js");
await import("../services/sorobanService.js");
const { default: app } = await import("../app.js");

const mockedQuery = mockQuery;

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

afterEach(() => {
  jest.clearAllMocks();
});

afterAll(() => {
  delete process.env.INTERNAL_API_KEY;
  delete process.env.JWT_SECRET;
});

// ---------------------------------------------------------------------------
// GET /api/loans/config
// ---------------------------------------------------------------------------
describe("GET /api/loans/config", () => {
  const originalMinScore = process.env.LOAN_MIN_SCORE;
  const originalMaxAmount = process.env.LOAN_MAX_AMOUNT;
  const originalInterest = process.env.LOAN_INTEREST_RATE_PERCENT;

  afterEach(() => {
    if (originalMinScore === undefined) {
      delete process.env.LOAN_MIN_SCORE;
    } else {
      process.env.LOAN_MIN_SCORE = originalMinScore;
    }

    if (originalMaxAmount === undefined) {
      delete process.env.LOAN_MAX_AMOUNT;
    } else {
      process.env.LOAN_MAX_AMOUNT = originalMaxAmount;
    }

    if (originalInterest === undefined) {
      delete process.env.LOAN_INTEREST_RATE_PERCENT;
    } else {
      process.env.LOAN_INTEREST_RATE_PERCENT = originalInterest;
    }
  });

  it("should return defaults when env values are not set", async () => {
    delete process.env.LOAN_MIN_SCORE;
    delete process.env.LOAN_MAX_AMOUNT;
    delete process.env.LOAN_INTEREST_RATE_PERCENT;

    const response = await request(app).get("/api/loans/config");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        minScore: 500,
        maxAmount: 50000,
        interestRatePercent: 12,
      },
    });
  });

  it("should return configured env values", async () => {
    process.env.LOAN_MIN_SCORE = "620";
    process.env.LOAN_MAX_AMOUNT = "65000";
    process.env.LOAN_INTEREST_RATE_PERCENT = "14";

    const response = await request(app).get("/api/loans/config");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        minScore: 620,
        maxAmount: 65000,
        interestRatePercent: 14,
      },
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/loans/request
// ---------------------------------------------------------------------------
describe("POST /api/loans/request", () => {
  it("should reject unauthenticated requests", async () => {
    const response = await request(app)
      .post("/api/loans/request")
      .send({ amount: 1000, borrowerPublicKey: "GABC123" });
    expect(response.status).toBe(401);
  });

  it("should reject when borrowerPublicKey does not match JWT", async () => {
    const response = await request(app)
      .post("/api/loans/request")
      .set(bearer("wallet-A"))
      .send({ amount: 1000, borrowerPublicKey: "wallet-B" });
    expect(response.status).toBe(403);
  });

  it("should return unsigned XDR for valid request", async () => {
    mockBuildRequestLoanTx.mockResolvedValueOnce({
      unsignedTxXdr: "AAAA...base64xdr",
      networkPassphrase: "Test SDF Network ; September 2015",
    });

    const response = await request(app)
      .post("/api/loans/request")
      .set(bearer("GABC123"))
      .send({ amount: 1000, borrowerPublicKey: "GABC123" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.unsignedTxXdr).toBe("AAAA...base64xdr");
    expect(response.body.networkPassphrase).toBeDefined();
  });

  it("should reject missing amount", async () => {
    const response = await request(app)
      .post("/api/loans/request")
      .set(bearer("GABC123"))
      .send({ borrowerPublicKey: "GABC123" });
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/loans/submit
// ---------------------------------------------------------------------------
describe("POST /api/loans/submit", () => {
  it("should reject unauthenticated requests", async () => {
    const response = await request(app)
      .post("/api/loans/submit")
      .send({ signedTxXdr: "signed-xdr" });
    expect(response.status).toBe(401);
  });

  it("should submit a signed transaction", async () => {
    mockSubmitSignedTx.mockResolvedValueOnce({
      txHash: "abc123hash",
      status: "SUCCESS",
    });

    const response = await request(app)
      .post("/api/loans/submit")
      .set(bearer("GABC123"))
      .send({ signedTxXdr: "signed-xdr-data" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.txHash).toBe("abc123hash");
    expect(response.body.status).toBe("SUCCESS");
  });

  it("should reject missing signedTxXdr", async () => {
    const response = await request(app)
      .post("/api/loans/submit")
      .set(bearer("GABC123"))
      .send({});
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/loans/:loanId/repay
// ---------------------------------------------------------------------------
describe("POST /api/loans/:loanId/repay", () => {
  it("should reject unauthenticated requests", async () => {
    const response = await request(app)
      .post("/api/loans/1/repay")
      .send({ amount: 500, borrowerPublicKey: "GABC123" });
    expect(response.status).toBe(401);
  });

  it("should return unsigned XDR for valid repayment", async () => {
    // requireLoanBorrowerAccess check
    mockedQuery.mockResolvedValueOnce({
      rows: [{ borrower: "GABC123" }],
    });

    mockBuildRepayTx.mockResolvedValueOnce({
      unsignedTxXdr: "BBBB...repay-xdr",
      networkPassphrase: "Test SDF Network ; September 2015",
    });

    const response = await request(app)
      .post("/api/loans/1/repay")
      .set(bearer("GABC123"))
      .send({ amount: 500, borrowerPublicKey: "GABC123" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.loanId).toBe(1);
    expect(response.body.unsignedTxXdr).toBe("BBBB...repay-xdr");
  });

  it("should return 404 when loan does not belong to user", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ borrower: "other-wallet" }],
    });

    const response = await request(app)
      .post("/api/loans/1/repay")
      .set(bearer("GABC123"))
      .send({ amount: 500, borrowerPublicKey: "GABC123" });

    expect(response.status).toBe(404);
  });

  it("should reject missing amount", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ borrower: "GABC123" }],
    });

    const response = await request(app)
      .post("/api/loans/1/repay")
      .set(bearer("GABC123"))
      .send({ borrowerPublicKey: "GABC123" });

    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/loans/:loanId/submit
// ---------------------------------------------------------------------------
describe("POST /api/loans/:loanId/submit", () => {
  it("should submit a signed repayment transaction", async () => {
    // requireLoanBorrowerAccess
    mockedQuery.mockResolvedValueOnce({
      rows: [{ borrower: "GABC123" }],
    });

    mockSubmitSignedTx.mockResolvedValueOnce({
      txHash: "repay-hash-456",
      status: "SUCCESS",
    });

    const response = await request(app)
      .post("/api/loans/1/submit")
      .set(bearer("GABC123"))
      .send({ signedTxXdr: "signed-repay-xdr" });

    expect(response.status).toBe(200);
    expect(response.body.txHash).toBe("repay-hash-456");
    expect(response.body.status).toBe("SUCCESS");
  });
});
