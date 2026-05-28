import { jest } from "@jest/globals";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";

const mockWithTransaction = jest.fn();
const mockQuery = jest.fn();

jest.unstable_mockModule("../db/connection.js", () => ({
  query: mockQuery,
  default: { query: mockQuery, connect: jest.fn(), end: jest.fn() },
}));

jest.unstable_mockModule("../db/transaction.js", () => ({
  withTransaction: mockWithTransaction,
}));

jest.unstable_mockModule("../config/stellar.js", () => ({
  getStellarNetworkPassphrase: () => Networks.TESTNET,
}));

const { remittanceService } = await import("../services/remittanceService.js");

const USDC_ISSUER = Keypair.random().publicKey();
const SENDER = Keypair.random().publicKey();
const RECIPIENT = Keypair.random().publicKey();

describe("remittanceService.createRemittance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.STELLAR_USDC_ISSUER;
    delete process.env.STELLAR_EURC_ISSUER;
    delete process.env.STELLAR_PHP_ISSUER;
  });

  it("rejects unsupported source currencies", async () => {
    await expect(
      remittanceService.createRemittance({
        recipientAddress: RECIPIENT,
        amount: 25,
        fromCurrency: "DOGE",
        toCurrency: "USDC",
        memo: "test",
        senderAddress: SENDER,
      }),
    ).rejects.toThrow("Unsupported currency: DOGE");
  });

  it("rejects token currencies when issuer is not configured", async () => {
    await expect(
      remittanceService.createRemittance({
        recipientAddress: RECIPIENT,
        amount: 25,
        fromCurrency: "USDC",
        toCurrency: "USDC",
        memo: "test",
        senderAddress: SENDER,
      }),
    ).rejects.toThrow("Unsupported currency: USDC");
  });

  it("builds token transfer XDR for configured USDC remittances", async () => {
    process.env.STELLAR_USDC_ISSUER = USDC_ISSUER;

    mockWithTransaction.mockImplementation(async (callback: any) => {
      const now = new Date();
      return callback({
        query: async (_sql: string, params: any[]) => ({
          rows: [
            {
              id: "remit-1",
              sender_id: SENDER,
              recipient_address: RECIPIENT,
              amount: "25",
              from_currency: "USDC",
              to_currency: "USDC",
              memo: "test",
              status: "pending",
              transaction_hash: null,
              xdr: params[8],
              created_at: now,
              updated_at: now,
            },
          ],
        }),
      });
    });

    const remittance = await remittanceService.createRemittance({
      recipientAddress: RECIPIENT,
      amount: 25,
      fromCurrency: "USDC",
      toCurrency: "USDC",
      memo: "test",
      senderAddress: SENDER,
    });

    const tx = TransactionBuilder.fromXDR(remittance.xdr!, Networks.TESTNET);
    const payment = tx.operations[0] as {
      asset: { getCode: () => string; getIssuer: () => string };
    };

    expect(payment.asset.getCode()).toBe("USDC");
    expect(payment.asset.getIssuer()).toBe(USDC_ISSUER);
  });
});

describe("remittanceService.getRemittances with filters", () => {
  let mockQuery: jest.MockedFunction<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery = jest.fn();
  });

  it("filters remittances by status", async () => {
    const { query: queryModule } = await import("../db/connection.js");
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "remit-1",
          sender_id: SENDER,
          recipient_address: RECIPIENT,
          amount: "100",
          from_currency: "USDC",
          to_currency: "USDC",
          memo: null,
          status: "completed",
          transaction_hash: "tx123",
          xdr: "xdr123",
          created_at: new Date("2024-03-01"),
          updated_at: new Date("2024-03-01"),
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: "1" }],
    });

    const result = await remittanceService.getRemittances(
      SENDER,
      20,
      null,
      "completed",
    );

    expect(result.remittances).toHaveLength(1);
    expect(result.remittances[0].status).toBe("completed");
    expect(result.total).toBe(1);
  });

  it("filters remittances by date range", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "remit-2",
          sender_id: SENDER,
          recipient_address: RECIPIENT,
          amount: "50",
          from_currency: "USDC",
          to_currency: "USDC",
          memo: null,
          status: "completed",
          transaction_hash: "tx456",
          xdr: "xdr456",
          created_at: new Date("2024-03-15"),
          updated_at: new Date("2024-03-15"),
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: "1" }],
    });

    const result = await remittanceService.getRemittances(
      SENDER,
      20,
      null,
      undefined,
      "2024-03-01",
      "2024-03-31",
    );

    expect(result.remittances).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it("searches remittances by recipient address", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "remit-3",
          sender_id: SENDER,
          recipient_address: RECIPIENT,
          amount: "75",
          from_currency: "USDC",
          to_currency: "USDC",
          memo: null,
          status: "completed",
          transaction_hash: "tx789",
          xdr: "xdr789",
          created_at: new Date("2024-03-10"),
          updated_at: new Date("2024-03-10"),
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: "1" }],
    });

    const result = await remittanceService.getRemittances(
      SENDER,
      20,
      null,
      undefined,
      undefined,
      undefined,
      RECIPIENT.substring(0, 10),
    );

    expect(result.remittances).toHaveLength(1);
    expect(result.remittances[0].recipientAddress).toBe(RECIPIENT);
  });

  it("combines multiple filters", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "remit-4",
          sender_id: SENDER,
          recipient_address: RECIPIENT,
          amount: "200",
          from_currency: "USDC",
          to_currency: "USDC",
          memo: "payment",
          status: "completed",
          transaction_hash: "tx999",
          xdr: "xdr999",
          created_at: new Date("2024-03-20"),
          updated_at: new Date("2024-03-20"),
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ total: "1" }],
    });

    const result = await remittanceService.getRemittances(
      SENDER,
      20,
      null,
      "completed",
      "2024-03-01",
      "2024-03-31",
      "payment",
    );

    expect(result.remittances).toHaveLength(1);
    expect(result.remittances[0].status).toBe("completed");
  });

  it("rejects invalid date formats", async () => {
    await expect(
      remittanceService.getRemittances(
        SENDER,
        20,
        null,
        undefined,
        "invalid-date",
      ),
    ).rejects.toThrow("Invalid 'from' date format");
  });
});
