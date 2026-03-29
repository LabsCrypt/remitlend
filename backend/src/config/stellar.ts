import { Networks, rpc } from "@stellar/stellar-sdk";

export type StellarNetwork = "testnet" | "mainnet";

interface StellarNetworkDefaults {
  rpcUrl: string;
  passphrase: string;
}

const STELLAR_DEFAULTS: Record<StellarNetwork, StellarNetworkDefaults> = {
  testnet: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    passphrase: Networks.TESTNET,
  },
  mainnet: {
    rpcUrl: "https://soroban-mainnet.stellar.org",
    passphrase: Networks.PUBLIC,
  },
};

export interface StellarConfig {
  network: StellarNetwork;
  rpcUrl: string;
  networkPassphrase: string;
}

function parseNetwork(value: string | undefined): StellarNetwork {
  const normalized = (value ?? "testnet").trim().toLowerCase();
  if (normalized === "testnet" || normalized === "mainnet") {
    return normalized;
  }

  throw new Error(
    `Invalid STELLAR_NETWORK "${value}". Expected "testnet" or "mainnet".`,
  );
}

function ensureValidRpcUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `Invalid STELLAR_RPC_URL "${value}". Expected a valid http(s) URL.`,
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `Invalid STELLAR_RPC_URL "${value}". Only http:// or https:// is supported.`,
    );
  }
}

function ensureRpcUrlMatchesNetwork(
  network: StellarNetwork,
  rpcUrl: string,
): void {
  const lower = rpcUrl.toLowerCase();
  const oppositeMarker = network === "testnet" ? "mainnet" : "testnet";

  if (lower.includes(oppositeMarker)) {
    throw new Error(
      `STELLAR_RPC_URL appears to target ${oppositeMarker} while STELLAR_NETWORK is "${network}".`,
    );
  }
}

function ensurePassphraseMatchesNetwork(
  network: StellarNetwork,
  passphrase: string,
): void {
  const expected = STELLAR_DEFAULTS[network].passphrase;
  if (passphrase !== expected) {
    throw new Error(
      `STELLAR_NETWORK_PASSPHRASE does not match STELLAR_NETWORK="${network}". Expected "${expected}".`,
    );
  }
}

export function getStellarConfig(): StellarConfig {
  const network = parseNetwork(process.env.STELLAR_NETWORK);
  const defaults = STELLAR_DEFAULTS[network];

  const rpcUrl = (process.env.STELLAR_RPC_URL ?? defaults.rpcUrl).trim();
  if (!rpcUrl) {
    throw new Error("STELLAR_RPC_URL cannot be empty.");
  }
  ensureValidRpcUrl(rpcUrl);
  ensureRpcUrlMatchesNetwork(network, rpcUrl);

  const networkPassphrase = (
    process.env.STELLAR_NETWORK_PASSPHRASE ?? defaults.passphrase
  ).trim();
  if (!networkPassphrase) {
    throw new Error("STELLAR_NETWORK_PASSPHRASE cannot be empty.");
  }
  ensurePassphraseMatchesNetwork(network, networkPassphrase);

  return {
    network,
    rpcUrl,
    networkPassphrase,
  };
}

export function getStellarRpcUrl(): string {
  return getStellarConfig().rpcUrl;
}

export function getStellarNetworkPassphrase(): string {
  return getStellarConfig().networkPassphrase;
}

const RPC_TIMEOUT_MS = 15_000;

function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

export function createSorobanRpcServer(): rpc.Server {
  const rpcUrl = getStellarRpcUrl();
  const allowHttp = rpcUrl.startsWith("http://");
  return new rpc.Server(rpcUrl, { allowHttp, fetch: fetchWithTimeout });
}
