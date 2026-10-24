/**
 * utils/soroban.networkMismatch.test.ts
 *
 * Regression coverage for issue #2143. The Soroban XDR builders in
 * `utils/soroban.ts` talk to an RPC endpoint that may be on a different network
 * than the connected wallet, may time out while simulating, or may answer with
 * a payload that is not a transaction. Every one of those paths has to fail
 * closed: the caller must receive a rejected promise (so `mapTransactionError`
 * keeps classifying it) and never an unsigned XDR that was not simulated on
 * the wallet's network.
 *
 * Contract pinned by these tests:
 *  - the returned XDR is bound to the passphrase it was built with, so the
 *    signed payload carries that network's id and a signature produced for one
 *    network never verifies on another;
 *  - simulation is always awaited and never replaced by the raw transaction
 *    when it fails, times out, or is still pending;
 *  - malformed account / simulation responses are rejected instead of being
 *    serialized into an XDR;
 *  - invocations carry no pre-filled authorization entries, and authorization
 *    failures raised during simulation propagate untouched.
 */

import type { Transaction } from "@stellar/stellar-sdk";

// `jest.setup.ts` installs the TextEncoder/TextDecoder globals jsdom lacks, so
// the Stellar SDK can be imported here without extra polyfills.
/* eslint-disable @typescript-eslint/no-require-imports */
const { Account, Keypair, Operation, rpc, TransactionBuilder } = require("@stellar/stellar-sdk");
const { buildUnsignedLoanRequestXdr, buildUnsignedRepaymentXdr } = require("./soroban");

import { NETWORK_PASSPHRASES, DEFAULT_NETWORK_PASSPHRASE } from "./networkPassphrase";

const TESTNET_PASSPHRASE = NETWORK_PASSPHRASES.TESTNET;
const PUBLIC_PASSPHRASE = NETWORK_PASSPHRASES.PUBLIC;

const BORROWER = Keypair.random().publicKey();
const CONTRACT_ID = Keypair.random().publicKey();

type Branch = {
  label: string;
  build: (params: Record<string, unknown>) => Promise<string>;
  extra: Record<string, unknown>;
};

const BRANCHES: Branch[] = [
  {
    label: "buildUnsignedLoanRequestXdr",
    build: buildUnsignedLoanRequestXdr,
    extra: { term: 12 },
  },
  {
    label: "buildUnsignedRepaymentXdr",
    build: buildUnsignedRepaymentXdr,
    extra: { loanId: "42" },
  },
];

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * The 32-byte network id a transaction commits to, obtained from the SDK rather
 * than re-implementing sha256(passphrase): `signatureBase()` is
 * `networkId || envelopeType || transaction`, so its first 32 bytes are exactly
 * the id the wallet will sign against for that passphrase.
 */
const networkId = (passphrase: string) => {
  const reference = new TransactionBuilder(new Account(BORROWER, "0"), {
    fee: "100",
    networkPassphrase: passphrase,
  })
    .addOperation(Operation.bumpSequence({ bumpTo: "1" }))
    .setTimeout(0)
    .build();

  return toHex(reference.signatureBase().subarray(0, 32));
};

/**
 * Parse a returned XDR under the given passphrase and expose the host
 * invocation it carries. Parsing under the "wrong" passphrase is deliberate:
 * it only changes the hash/signature base, never the operation itself.
 */
const readInvocation = (xdrString: string, passphrase: string) => {
  const tx = TransactionBuilder.fromXDR(xdrString, passphrase) as Transaction;
  const [op] = tx.operations;

  if (!("func" in op)) {
    throw new Error("expected a host invocation operation");
  }

  return { tx, call: op.func.invokeContract(), auth: op.auth };
};

describe("Soroban builders: RPC network, simulation timeout and malformed responses (issue #2143)", () => {
  describe.each(BRANCHES)("$label", ({ build, extra }) => {
    const params = (overrides: Record<string, unknown> = {}) => ({
      borrower: BORROWER,
      amount: 1000,
      contractId: CONTRACT_ID,
      ...extra,
      ...overrides,
    });

    let getAccountSpy;
    let prepareSpy;

    beforeEach(() => {
      getAccountSpy = jest
        .spyOn(rpc.Server.prototype, "getAccount")
        .mockResolvedValue(new Account(BORROWER, "100"));
      // Simulation is stubbed so the suite stays offline and returns the built
      // transaction unchanged, mirroring a healthy RPC on the same network.
      prepareSpy = jest
        .spyOn(rpc.Server.prototype, "prepareTransaction")
        .mockImplementation((tx: unknown) => Promise.resolve(tx));
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    describe("network mismatch", () => {
      it("binds the returned XDR to the wallet's network id", async () => {
        const xdrString = await build(params({ networkPassphrase: PUBLIC_PASSPHRASE }));

        const { tx } = readInvocation(xdrString, PUBLIC_PASSPHRASE);
        const signedPayloadPrefix = tx.signatureBase().subarray(0, 32);

        expect(toHex(signedPayloadPrefix)).toBe(networkId(PUBLIC_PASSPHRASE));
        expect(toHex(signedPayloadPrefix)).not.toBe(networkId(TESTNET_PASSPHRASE));
        expect(prepareSpy).toHaveBeenCalledTimes(1);
      });

      it("hashes the same invocation differently on TESTNET and PUBLIC", async () => {
        const testnetXdr = await build(params({ networkPassphrase: TESTNET_PASSPHRASE }));
        const publicXdr = await build(params({ networkPassphrase: PUBLIC_PASSPHRASE }));

        const testnetTx = TransactionBuilder.fromXDR(testnetXdr, TESTNET_PASSPHRASE) as Transaction;
        const publicTx = TransactionBuilder.fromXDR(publicXdr, PUBLIC_PASSPHRASE) as Transaction;
        expect(testnetTx.hash().equals(publicTx.hash())).toBe(false);

        // Reading the TESTNET XDR under PUBLIC produces yet another hash: that
        // mismatch is what makes a wallet on the wrong network unable to sign.
        const crossNetworkTx = TransactionBuilder.fromXDR(
          testnetXdr,
          PUBLIC_PASSPHRASE,
        ) as Transaction;
        expect(crossNetworkTx.hash().equals(testnetTx.hash())).toBe(false);
      });

      it("only verifies a signature on the network the XDR was built for", async () => {
        const xdrString = await build(params({ networkPassphrase: TESTNET_PASSPHRASE }));
        const { tx } = readInvocation(xdrString, TESTNET_PASSPHRASE);
        const signer = Keypair.random();

        tx.sign(signer);
        const signature = tx.signatures[0].signature();

        expect(signer.verify(tx.hash(), signature)).toBe(true);

        const mismatchTx = TransactionBuilder.fromXDR(xdrString, PUBLIC_PASSPHRASE) as Transaction;
        expect(signer.verify(mismatchTx.hash(), signature)).toBe(false);
      });

      it("prefers the caller's passphrase over the ambient env value", async () => {
        const previous = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
        process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = TESTNET_PASSPHRASE;

        try {
          const xdrString = await build(params({ networkPassphrase: PUBLIC_PASSPHRASE }));
          const { tx } = readInvocation(xdrString, PUBLIC_PASSPHRASE);

          // A TESTNET value in the environment must not leak into a PUBLIC build.
          expect(toHex(tx.signatureBase().subarray(0, 32))).toBe(networkId(PUBLIC_PASSPHRASE));
        } finally {
          if (previous === undefined) {
            delete process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
          } else {
            process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = previous;
          }
        }
      });

      it("falls back to the shared default passphrase when none is provided", async () => {
        const previous = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;
        delete process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE;

        try {
          const xdrString = await build(params());
          const { tx } = readInvocation(xdrString, DEFAULT_NETWORK_PASSPHRASE);

          expect(toHex(tx.signatureBase().subarray(0, 32))).toBe(
            networkId(DEFAULT_NETWORK_PASSPHRASE),
          );
          expect(networkId(DEFAULT_NETWORK_PASSPHRASE)).toBe(networkId(TESTNET_PASSPHRASE));
          expect(DEFAULT_NETWORK_PASSPHRASE).not.toBe(PUBLIC_PASSPHRASE);
        } finally {
          if (previous !== undefined) {
            process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = previous;
          }
        }
      });

      it("propagates a network mismatch reported by the RPC endpoint instead of returning an XDR", async () => {
        prepareSpy.mockRejectedValue(
          new Error("network passphrase does not match this RPC endpoint: expected TESTNET"),
        );

        await expect(build(params({ networkPassphrase: TESTNET_PASSPHRASE }))).rejects.toThrow(
          /network passphrase does not match/i,
        );
        expect(prepareSpy).toHaveBeenCalledTimes(1);
      });
    });

    describe("simulation timeout", () => {
      it("rejects when simulation times out and never serializes the unprepared transaction", async () => {
        prepareSpy.mockRejectedValue(
          new Error("simulation timed out after 30000ms: rpc.simulateTransaction"),
        );

        await expect(build(params())).rejects.toThrow(/timed out/i);
        // Exactly one attempt: the builder must not retry or fall back to the
        // raw transaction, which would ship an empty footprint to the network.
        expect(prepareSpy).toHaveBeenCalledTimes(1);
      });

      it("does not resolve while simulation is still pending", async () => {
        let releaseSimulation: (value: unknown) => void = () => undefined;
        const pendingSimulation = new Promise((resolve) => {
          releaseSimulation = resolve;
        });
        prepareSpy.mockImplementation(() => pendingSimulation);

        const building = build(params());
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(prepareSpy).toHaveBeenCalledTimes(1);

        let settled = false;
        void building.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(settled).toBe(false);

        // Releasing the simulation lets the builder finish normally, proving
        // the pending state above came from the awaited simulation only.
        releaseSimulation(prepareSpy.mock.calls[0][0]);
        await expect(building).resolves.toEqual(expect.any(String));
      });
    });

    describe("malformed responses", () => {
      it("rejects a malformed account response before simulating", async () => {
        getAccountSpy.mockResolvedValue({ accountId: BORROWER });

        await expect(build(params())).rejects.toThrow(TypeError);
        expect(prepareSpy).not.toHaveBeenCalled();
      });

      it("rejects when the RPC account lookup fails", async () => {
        getAccountSpy.mockRejectedValue(new Error("account not found"));

        await expect(build(params())).rejects.toThrow(/account not found/i);
        expect(prepareSpy).not.toHaveBeenCalled();
      });

      it("rejects a null simulation response", async () => {
        prepareSpy.mockResolvedValue(null);

        await expect(build(params())).rejects.toThrow(TypeError);
      });

      it("rejects a simulation response that cannot serialize a transaction", async () => {
        prepareSpy.mockResolvedValue({ status: "PENDING", latestLedger: 42 });

        await expect(build(params())).rejects.toThrow(TypeError);
      });

      it("propagates a malformed JSON-RPC error payload unchanged", async () => {
        const jsonRpcError = { code: -32603, message: "Internal error", data: { status: "ERROR" } };
        prepareSpy.mockRejectedValue(jsonRpcError);

        await expect(build(params())).rejects.toBe(jsonRpcError);
      });
    });

    describe("authorization", () => {
      it("sends the invocation without pre-filled authorization entries", async () => {
        const xdrString = await build(params({ networkPassphrase: TESTNET_PASSPHRASE }));

        const { auth, call } = readInvocation(xdrString, TESTNET_PASSPHRASE);
        // The connected wallet supplies the signature; the contract's own
        // authorization gate is what the network enforces afterwards.
        expect(auth).toHaveLength(0);
        expect(call.args()).toHaveLength(3);
      });

      it("propagates authorization failures raised during simulation", async () => {
        prepareSpy.mockRejectedValue(
          new Error("HostError: Error(Auth, InvalidAction) while running require_auth"),
        );

        await expect(build(params())).rejects.toThrow(/Error\(Auth, InvalidAction\)/);
      });
    });

    describe("input validation stays fail-closed", () => {
      it.each([
        ["NaN", Number.NaN],
        ["Infinity", Number.POSITIVE_INFINITY],
        ["1e21", 1e21],
      ])(
        "rejects an amount that is not a plain decimal (%s) without simulating",
        async (_label, amount) => {
          await expect(build(params({ amount }))).rejects.toThrow(/Invalid amount/);
          expect(prepareSpy).not.toHaveBeenCalled();
        },
      );

      it("rejects an unparseable contract id before simulating", async () => {
        await expect(build(params({ contractId: "not-a-contract" }))).rejects.toThrow(
          /Unsupported address type/,
        );
        expect(prepareSpy).not.toHaveBeenCalled();
      });

      if (extra.term !== undefined) {
        it("accepts the largest u32 term", async () => {
          const xdrString = await build(params({ term: 4294967295 }));

          expect(xdrString.length).toBeGreaterThan(0);
          expect(prepareSpy).toHaveBeenCalledTimes(1);
        });
      }

      if (extra.loanId !== undefined) {
        it("accepts the largest u64 loan id", async () => {
          const xdrString = await build(params({ loanId: "18446744073709551615" }));

          expect(xdrString.length).toBeGreaterThan(0);
          expect(prepareSpy).toHaveBeenCalledTimes(1);
        });

        it("rejects a fractional loan id instead of truncating it", async () => {
          await expect(build(params({ loanId: "12.5" }))).rejects.toThrow(SyntaxError);
          expect(prepareSpy).not.toHaveBeenCalled();
        });

        it("rejects a negative loan id because u64 is unsigned", async () => {
          await expect(build(params({ loanId: "-1" }))).rejects.toThrow(/negative/);
          expect(prepareSpy).not.toHaveBeenCalled();
        });
      }
    });
  });
});
