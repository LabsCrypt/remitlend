import { afterEach, describe, expect, it } from "@jest/globals";
import { Networks } from "@stellar/stellar-sdk";
import { getStellarConfig } from "../config/stellar.js";

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
