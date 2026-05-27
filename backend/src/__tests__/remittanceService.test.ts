import { jest } from "@jest/globals";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";

const mockWithTransaction = jest.fn();

jest.unstable_mockModule("../db/connection.js", () => ({
  query: jest.fn(),
  default: { query: jest.fn(), connect: jest.fn(), end: jest.fn() },
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
