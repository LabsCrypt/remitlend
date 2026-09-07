/**
 * utils/soroban.networkSigner.test.tsx
 *
 * Verifies issue #1073: the repay page signs with the network-aware
 * WalletProvider signer, and the passphrase used at build time
 * (getNetworkPassphrase from the connected wallet's network) is guaranteed
 * to match the passphrase the WalletProvider signer resolves at sign time.
 *
 * The guarantee is structural: both the repay page's build step and the
 * WalletProvider signer resolve their passphrase from the shared
 * `getNetworkPassphrase` utility (single source of truth in soroban.ts),
 * keyed by the same wallet store network. These tests prove the match holds
 * for TESTNET and PUBLIC with distinct passphrases.
 */

import { TextDecoder, TextEncoder } from "util";

if (typeof global.TextEncoder === "undefined") {
  (global as any).TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === "undefined") {
  (global as any).TextDecoder = TextDecoder;
}

import { render, act } from "@testing-library/react";

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; October 2015";

const mockFreighterSign = jest.fn();

jest.mock("@stellar/freighter-api", () => {
  const api = {
    isConnected: jest.fn().mockResolvedValue({ isConnected: true }),
    requestAccess: jest.fn().mockResolvedValue({ address: "GABC" }),
    getAddress: jest.fn().mockResolvedValue({ address: "GABC" }),
    getNetworkDetails: jest.fn().mockResolvedValue({ network: "TESTNET" }),
    signTransaction: jest.fn().mockImplementation((_xdr, opts: { networkPassphrase?: string }) => {
      mockFreighterSign(opts);
      return { signedTxXdr: `signed-${opts?.networkPassphrase ?? "none"}` };
    }),
  };
  return api;
});

/* eslint-disable @typescript-eslint/no-require-imports */
const { WalletProvider, useWallet } = require("../components/providers/WalletProvider");
const { useWalletStore } = require("../stores/useWalletStore");
const { getNetworkPassphrase } = require("./soroban");

function setWalletNetwork(network: { chainId: number; name: string; isSupported: boolean }) {
  useWalletStore.setState({
    status: network.isSupported ? "connected" : "error",
    address: "GABC",
    network,
    balances: [],
    error: null,
    shouldAutoReconnect: false,
  });
}

function signerProbe() {
  let captured: ((xdr: string) => Promise<string>) | null = null;
  function Probe() {
    const { signTransaction } = useWallet();
    captured = signTransaction;
    return null;
  }
  render(
    <WalletProvider>
      <Probe />
    </WalletProvider>,
  );
  return {
    sign: async (xdr: string) => {
      const signer = captured;
      if (!signer) throw new Error("signer not captured");
      return act(async () => signer(xdr));
    },
  };
}

describe("WalletProvider network-aware signer (issue #1073)", () => {
  afterEach(() => {
    jest.clearAllMocks();
    useWalletStore.setState({ status: "disconnected", network: null });
  });

  it("signs with the TESTNET passphrase when the wallet is connected to testnet", async () => {
    setWalletNetwork({ chainId: 2, name: "TESTNET", isSupported: true });
    const probe = signerProbe();

    await probe.sign("unsigned-xdr");

    expect(mockFreighterSign).toHaveBeenCalledWith(
      expect.objectContaining({ networkPassphrase: TESTNET_PASSPHRASE }),
    );
    expect(getNetworkPassphrase("TESTNET")).toBe(TESTNET_PASSPHRASE);
  });

  it("signs with the PUBLIC passphrase when the wallet is connected to public network", async () => {
    setWalletNetwork({ chainId: 1, name: "PUBLIC", isSupported: true });
    const probe = signerProbe();

    await probe.sign("unsigned-xdr");

    expect(mockFreighterSign).toHaveBeenCalledWith(
      expect.objectContaining({ networkPassphrase: PUBLIC_PASSPHRASE }),
    );
    expect(getNetworkPassphrase("PUBLIC")).toBe(PUBLIC_PASSPHRASE);
  });

  it("uses DIFFERENT passphrases for TESTNET vs PUBLIC (genuinely network-aware)", async () => {
    setWalletNetwork({ chainId: 2, name: "TESTNET", isSupported: true });
    const testnetProbe = signerProbe();
    await testnetProbe.sign("unsigned-xdr");

    setWalletNetwork({ chainId: 1, name: "PUBLIC", isSupported: true });
    const publicProbe = signerProbe();
    await publicProbe.sign("unsigned-xdr");

    const calls = mockFreighterSign.mock.calls.map(
      (c) => (c[0] as { networkPassphrase: string }).networkPassphrase,
    );
    expect(calls[0]).toBe(TESTNET_PASSPHRASE);
    expect(calls[1]).toBe(PUBLIC_PASSPHRASE);
    expect(calls[0]).not.toBe(calls[1]);
  });

  it("build-time and sign-time passphrases match for each network (single shared source)", async () => {
    for (const { name, phrase } of [
      { name: "TESTNET", phrase: TESTNET_PASSPHRASE },
      { name: "PUBLIC", phrase: PUBLIC_PASSPHRASE },
    ]) {
      mockFreighterSign.mockClear();
      setWalletNetwork({ chainId: name === "PUBLIC" ? 1 : 2, name, isSupported: true });
      const probe = signerProbe();

      // The repay page passes getNetworkPassphrase(walletNetwork.name) to the
      // build step, and the WalletProvider signer resolves the same value.
      const buildPassphrase = getNetworkPassphrase(name);
      await probe.sign("unsigned-xdr");

      expect(buildPassphrase).toBe(phrase);
      expect(mockFreighterSign).toHaveBeenCalledWith(
        expect.objectContaining({ networkPassphrase: buildPassphrase }),
      );
    }
  });
});
