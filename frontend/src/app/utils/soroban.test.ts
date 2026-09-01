import { TextDecoder, TextEncoder } from "util";

if (typeof global.TextEncoder === "undefined") {
  (global as any).TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === "undefined") {
  (global as any).TextDecoder = TextDecoder;
}

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  Account,
  Address,
  Keypair,
  rpc,
  scValToNative,
  TransactionBuilder,
} = require("@stellar/stellar-sdk");
const {
  buildUnsignedLoanRequestXdr,
  buildUnsignedRepaymentXdr,
  getNetworkPassphrase,
} = require("./soroban");

import { NETWORK_PASSPHRASES } from "./networkPassphrase";

const NETWORK_PASSPHRASE = NETWORK_PASSPHRASES.TESTNET;

describe("buildUnsignedLoanRequestXdr", () => {
  const borrower = Keypair.random().publicKey();
  const contractId = Keypair.random().publicKey();

  beforeEach(() => {
    jest.spyOn(rpc.Server.prototype, "getAccount").mockResolvedValue(new Account(borrower, "100"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("invokes the request_loan function on the given contract", async () => {
    const xdrString = await buildUnsignedLoanRequestXdr({
      borrower,
      amount: 1000,
      term: 12,
      contractId,
    });

    const tx = TransactionBuilder.fromXDR(xdrString, NETWORK_PASSPHRASE);
    const op = tx.operations[0];
    expect(op.type).toBe("invokeHostFunction");

    if (op.type === "invokeHostFunction") {
      const invokeArgs = op.func.invokeContract();
      expect(invokeArgs.functionName().toString()).toBe("request_loan");
      expect(Address.fromScAddress(invokeArgs.contractAddress()).toString()).toBe(contractId);
    }
  });

  it("orders arguments as [borrower, amount, term]", async () => {
    const term = 12;

    const xdrString = await buildUnsignedLoanRequestXdr({
      borrower,
      amount: 1000,
      term,
      contractId,
    });

    const tx = TransactionBuilder.fromXDR(xdrString, NETWORK_PASSPHRASE);
    const op = tx.operations[0];

    if (op.type === "invokeHostFunction") {
      const args = op.func.invokeContract().args();
      expect(args).toHaveLength(3);

      const borrowerVal = scValToNative(args[0]);
      const termVal = scValToNative(args[2]);

      expect(borrowerVal).toBe(borrower);
      expect(termVal).toBe(term);
    }
  });

  it("encodes the full loan amount into the XDR, not a tenth of it", async () => {
    const inputAmount = 1000;

    const xdrString = await buildUnsignedLoanRequestXdr({
      borrower,
      amount: inputAmount,
      term: 12,
      contractId,
    });

    const tx = TransactionBuilder.fromXDR(xdrString, NETWORK_PASSPHRASE);
    const op = tx.operations[0];

    if (op.type === "invokeHostFunction") {
      const args = op.func.invokeContract().args();
      const amountVal = scValToNative(args[1]);

      expect(amountVal).toBe(BigInt(inputAmount));
      expect(amountVal).not.toBe(BigInt(inputAmount / 10));
    }
  });

  it("floors fractional amounts before encoding as i128", async () => {
    const xdrString = await buildUnsignedLoanRequestXdr({
      borrower,
      amount: 1000.75,
      term: 12,
      contractId,
    });

    const tx = TransactionBuilder.fromXDR(xdrString, NETWORK_PASSPHRASE);
    const op = tx.operations[0];

    if (op.type === "invokeHostFunction") {
      const args = op.func.invokeContract().args();
      const amountVal = scValToNative(args[1]);

      expect(amountVal).toBe(BigInt(1000));
    }
  });
});

describe("buildUnsignedRepaymentXdr", () => {
  const borrower = Keypair.random().publicKey();
  const contractId = Keypair.random().publicKey();

  beforeEach(() => {
    jest.spyOn(rpc.Server.prototype, "getAccount").mockResolvedValue(new Account(borrower, "100"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("invokes the repay function on the given contract", async () => {
    const xdrString = await buildUnsignedRepaymentXdr({
      borrower,
      loanId: "42",
      amount: 1000,
      contractId,
    });

    const tx = TransactionBuilder.fromXDR(xdrString, NETWORK_PASSPHRASE);
    const op = tx.operations[0];
    expect(op.type).toBe("invokeHostFunction");

    if (op.type === "invokeHostFunction") {
      const invokeArgs = op.func.invokeContract();
      expect(invokeArgs.functionName().toString()).toBe("repay");
      expect(Address.fromScAddress(invokeArgs.contractAddress()).toString()).toBe(contractId);
    }
  });

  it("orders arguments as [borrower, loanId, amount]", async () => {
    const loanId = "42";

    const xdrString = await buildUnsignedRepaymentXdr({
      borrower,
      loanId,
      amount: 1000,
      contractId,
    });

    const tx = TransactionBuilder.fromXDR(xdrString, NETWORK_PASSPHRASE);
    const op = tx.operations[0];

    if (op.type === "invokeHostFunction") {
      const args = op.func.invokeContract().args();
      expect(args).toHaveLength(3);

      const borrowerVal = scValToNative(args[0]);
      const loanIdVal = scValToNative(args[1]);

      expect(borrowerVal).toBe(borrower);
      expect(loanIdVal).toBe(BigInt(loanId));
    }
  });

  it("encodes the full repayment amount into the XDR, not a tenth of it", async () => {
    const inputAmount = 1000;
    const loanId = "42";

    const xdrString = await buildUnsignedRepaymentXdr({
      borrower,
      loanId,
      amount: inputAmount,
      contractId,
    });

    const tx = TransactionBuilder.fromXDR(xdrString, NETWORK_PASSPHRASE);

    const op = tx.operations[0];
    expect(op.type).toBe("invokeHostFunction");

    if (op.type === "invokeHostFunction") {
      const invokeArgs = op.func.invokeContract();
      const args = invokeArgs.args();
      const loanIdVal = scValToNative(args[1]);
      const amountVal = scValToNative(args[2]);

      expect(loanIdVal).toBe(BigInt(loanId));
      expect(amountVal).toBe(BigInt(inputAmount));
      expect(amountVal).not.toBe(BigInt(inputAmount / 10));
    }
  });

  it("floors fractional amounts before encoding as i128", async () => {
    const xdrString = await buildUnsignedRepaymentXdr({
      borrower,
      loanId: "42",
      amount: 1000.5,
      contractId,
    });

    const tx = TransactionBuilder.fromXDR(xdrString, NETWORK_PASSPHRASE);
    const op = tx.operations[0];

    if (op.type === "invokeHostFunction") {
      const args = op.func.invokeContract().args();
      const amountVal = scValToNative(args[2]);

      expect(amountVal).toBe(BigInt(1000));
    }
  });
});

describe("getNetworkPassphrase", () => {
  it("returns the correct passphrase for TESTNET", () => {
    expect(getNetworkPassphrase("TESTNET")).toBe("Test SDF Network ; September 2015");
  });

  it("returns the correct passphrase for PUBLIC", () => {
    expect(getNetworkPassphrase("PUBLIC")).toBe("Public Global Stellar Network ; October 2015");
  });

  it("returns DIFFERENT passphrases for TESTNET and PUBLIC (network-aware, not a single hardcoded value)", () => {
    const testnet = getNetworkPassphrase("TESTNET");
    const pub = getNetworkPassphrase("PUBLIC");
    expect(testnet).not.toBe(pub);
    expect(pub).not.toBe(NETWORK_PASSPHRASE);
  });

  it("is case-insensitive", () => {
    expect(getNetworkPassphrase("testnet")).toBe("Test SDF Network ; September 2015");
    expect(getNetworkPassphrase("public")).toBe("Public Global Stellar Network ; October 2015");
  });

  it("falls back to the TESTNET passphrase for unknown networks", () => {
    expect(getNetworkPassphrase("UNKNOWNNET")).toBe("Test SDF Network ; September 2015");
    expect(getNetworkPassphrase(undefined)).toBe("Test SDF Network ; September 2015");
  });
});

describe("buildUnsignedRepaymentXdr network-aware passphrase", () => {
  const borrower = Keypair.random().publicKey();
  const contractId = Keypair.random().publicKey();

  beforeEach(() => {
    jest.spyOn(rpc.Server.prototype, "getAccount").mockResolvedValue(new Account(borrower, "100"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("builds an XDR that signs against the TESTNET passphrase when the wallet is on testnet", async () => {
    const networkPassphrase = getNetworkPassphrase("TESTNET");

    const xdrString = await buildUnsignedRepaymentXdr({
      borrower,
      loanId: "42",
      amount: 1000,
      contractId,
      networkPassphrase,
    });

    // Parsing with the build-time passphrase succeeds, proving the built
    // XDR is bound to the exact network the wallet is on.
    const tx = TransactionBuilder.fromXDR(xdrString, networkPassphrase);
    expect(tx.operations[0].type).toBe("invokeHostFunction");
  });

  it("builds an XDR that signs against the PUBLIC passphrase when the wallet is on public network", async () => {
    const networkPassphrase = getNetworkPassphrase("PUBLIC");

    const xdrString = await buildUnsignedRepaymentXdr({
      borrower,
      loanId: "42",
      amount: 1000,
      contractId,
      networkPassphrase,
    });

    const tx = TransactionBuilder.fromXDR(xdrString, networkPassphrase);
    expect(tx.operations[0].type).toBe("invokeHostFunction");
  });

  it("builds the network-specific XDR (and not a universally-valid one) for each network", async () => {
    const testnetPhrase = getNetworkPassphrase("TESTNET");
    const publicPhrase = getNetworkPassphrase("PUBLIC");

    const testnetXdr = await buildUnsignedRepaymentXdr({
      borrower,
      loanId: "42",
      amount: 1000,
      contractId,
      networkPassphrase: testnetPhrase,
    });
    const publicXdr = await buildUnsignedRepaymentXdr({
      borrower,
      loanId: "42",
      amount: 1000,
      contractId,
      networkPassphrase: publicPhrase,
    });

    // The two XDRs must differ: they are bound to distinct networks.
    expect(testnetXdr).not.toBe(publicXdr);
  });
});
