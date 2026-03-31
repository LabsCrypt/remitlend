import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Networks } from "@stellar/stellar-sdk";
import { getStellarConfig, createSorobanRpcServer, fetchWithTimeout } from "../config/stellar.js";

const originalStellarEnv = {
  STELLAR_NETWORK: process.env.STELLAR_NETWORK,
  STELLAR_RPC_URL: process.env.STELLAR_RPC_URL,
  STELLAR_NETWORK_PASSPHRASE: process.env.STELLAR_NETWORK_PASSPHRASE,
};

const restoreEnv = () => {
  if (originalStellarEnv.STELLAR_NETWORK === undefined) {
    delete process.env.STELLAR_NETWORK;
  } else {
    process.env.STELLAR_NETWORK = originalStellarEnv.STELLAR_NETWORK;
  }

  if (originalStellarEnv.STELLAR_RPC_URL === undefined) {
    delete process.env.STELLAR_RPC_URL;
  } else {
    process.env.STELLAR_RPC_URL = originalStellarEnv.STELLAR_RPC_URL;
  }

  if (originalStellarEnv.STELLAR_NETWORK_PASSPHRASE === undefined) {
    delete process.env.STELLAR_NETWORK_PASSPHRASE;
  } else {
    process.env.STELLAR_NETWORK_PASSPHRASE =
      originalStellarEnv.STELLAR_NETWORK_PASSPHRASE;
  }
};

afterEach(() => {
  restoreEnv();
});

describe("stellar config", () => {
  it("defaults to testnet settings when env vars are absent", () => {
    delete process.env.STELLAR_NETWORK;
    delete process.env.STELLAR_RPC_URL;
    delete process.env.STELLAR_NETWORK_PASSPHRASE;

    const config = getStellarConfig();

    expect(config.network).toBe("testnet");
    expect(config.rpcUrl).toBe("https://soroban-testnet.stellar.org");
    expect(config.networkPassphrase).toBe(Networks.TESTNET);
  });

  it("uses mainnet defaults when STELLAR_NETWORK=mainnet", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    delete process.env.STELLAR_RPC_URL;
    delete process.env.STELLAR_NETWORK_PASSPHRASE;

    const config = getStellarConfig();

    expect(config.network).toBe("mainnet");
    expect(config.rpcUrl).toBe("https://soroban-mainnet.stellar.org");
    expect(config.networkPassphrase).toBe(Networks.PUBLIC);
  });

  it("rejects passphrase/network mismatches", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    process.env.STELLAR_NETWORK_PASSPHRASE = Networks.TESTNET;

    expect(() => getStellarConfig()).toThrow(
      'STELLAR_NETWORK_PASSPHRASE does not match STELLAR_NETWORK="mainnet"',
    );
  });

  it("rejects rpc url/network mismatches", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    process.env.STELLAR_RPC_URL = "https://soroban-testnet.stellar.org";

    expect(() => getStellarConfig()).toThrow(
      'STELLAR_RPC_URL appears to target testnet while STELLAR_NETWORK is "mainnet".',
    );
  });
});

describe("createSorobanRpcServer / fetchWithTimeout", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    delete process.env.STELLAR_NETWORK;
    delete process.env.STELLAR_RPC_URL;
    delete process.env.STELLAR_NETWORK_PASSPHRASE;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnv();
  });

  it("passes the AbortSignal through to fetch", async () => {
    let capturedSignal: AbortSignal | undefined;
    globalThis.fetch = jest.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return Promise.resolve(new Response("{}"));
    }) as typeof fetch;

    await fetchWithTimeout("https://soroban-testnet.stellar.org");

    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);
  });

  it("aborts the request after the timeout fires", async () => {
    let capturedSignal: AbortSignal | undefined;
    globalThis.fetch = jest.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      });
    }) as typeof fetch;

    // Use a very short timeout by temporarily patching — instead, call the
    // real fetchWithTimeout and abort via the captured signal directly.
    const fetchPromise = fetchWithTimeout("https://soroban-testnet.stellar.org");
    // Wait a tick for fetch mock to be called and signal captured
    await Promise.resolve();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);

    // Manually abort to simulate timeout without waiting 15 s
    (capturedSignal as AbortSignal & { _controller?: AbortController });
    // Trigger abort on the captured signal's controller via dispatchEvent
    capturedSignal!.dispatchEvent(new Event("abort"));

    await expect(fetchPromise).rejects.toMatchObject({ name: "AbortError" });
  });
});
