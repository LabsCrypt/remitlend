import { jest } from "@jest/globals";

const mockGetAccount = jest.fn();
const mockPrepareTransaction = jest.fn();
const mockSendTransaction = jest.fn();
const mockPollTransaction = jest.fn();

jest.mock("@stellar/stellar-sdk", () => ({
  BASE_FEE: "100",
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  Operation: { invokeContractFunction: jest.fn(() => ({})) },
  TransactionBuilder: class {
    addOperation() { return this; }
    setTimeout() { return this; }
    build() { return { toXDR: () => "xdr" }; }
    static fromXDR() { return {}; }
  },
  nativeToScVal: jest.fn(() => ({})),
  Address: { fromString: jest.fn(() => ({})) },
  xdr: {},
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      getAccount: mockGetAccount,
      prepareTransaction: mockPrepareTransaction,
      sendTransaction: mockSendTransaction,
      pollTransaction: mockPollTransaction,
    })),
  },
}));

const { sorobanService } = await import("../services/sorobanService.js");

// Flush all pending microtasks then advance fake timers past the timeout
async function triggerTimeout(promise: Promise<unknown>, advanceMs: number): Promise<string> {
  const result = promise.then(() => "resolved", (e: Error) => e.message);
  await Promise.resolve(); // flush microtasks so intermediate awaits settle
  jest.advanceTimersByTime(advanceMs);
  return result;
}

describe("sorobanService – RPC timeout enforcement", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    process.env.LOAN_MANAGER_CONTRACT_ID = "CONTRACT_ID";
    process.env.LENDING_POOL_CONTRACT_ID = "POOL_ID";
    process.env.POOL_TOKEN_ADDRESS = "TOKEN_ADDR";
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("times out buildRequestLoanTx when getAccount hangs", async () => {
    mockGetAccount.mockReturnValue(new Promise(() => {}));
    const msg = await triggerTimeout(sorobanService.buildRequestLoanTx("GBORROWER", 1000), 15_001);
    expect(msg).toMatch(/timed out/i);
  });

  it("times out buildRequestLoanTx when prepareTransaction hangs", async () => {
    mockGetAccount.mockResolvedValue({});
    mockPrepareTransaction.mockReturnValue(new Promise(() => {}));
    // flush getAccount resolution before advancing timers
    const promise = sorobanService.buildRequestLoanTx("GBORROWER", 1000);
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(15_001);
    await expect(promise).rejects.toThrow(/timed out/i);
  });

  it("times out submitSignedTx when sendTransaction hangs", async () => {
    mockSendTransaction.mockReturnValue(new Promise(() => {}));
    const msg = await triggerTimeout(sorobanService.submitSignedTx("signedXdr"), 15_001);
    expect(msg).toMatch(/timed out/i);
  });

  it("times out submitSignedTx when pollTransaction hangs", async () => {
    mockSendTransaction.mockResolvedValue({ hash: "abc123", status: "PENDING" });
    mockPollTransaction.mockReturnValue(new Promise(() => {}));
    const promise = sorobanService.submitSignedTx("signedXdr");
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(60_001);
    await expect(promise).rejects.toThrow(/timed out/i);
  });
});
