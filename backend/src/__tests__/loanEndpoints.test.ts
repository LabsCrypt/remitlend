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
jest.unstable_mockModule("../db/connection.js", () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
}));

// Mock sorobanService to avoid real Stellar RPC calls
const mockBuildRequestLoanTx = jest.fn<
  (
    borrowerPublicKey: string,
    amount: number,
  ) => Promise<{ unsignedTxXdr: string; networkPassphrase: string }>
>();
const mockBuildRepayTx = jest.fn<
  (
    borrowerPublicKey: string,
    loanId: number,
    amount: number,
  ) => Promise<{ unsignedTxXdr: string; networkPassphrase: string }>
>();
const mockSubmitSignedTx = jest.fn<
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

  it("should return 403 when loan does not belong to user", async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{ borrower: "other-wallet" }],
    });

    const response = await request(app)
      .post("/api/loans/1/repay")
      .set(bearer("GABC123"))
      .send({ amount: 500, borrowerPublicKey: "GABC123" });

    expect(response.status).toBe(403);
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
