"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { TokenBalance, WalletNetwork, WalletStatus } from "../../stores/useWalletStore";
import { useWalletStore } from "../../stores/useWalletStore";

type FreighterApi = typeof import("@stellar/freighter-api");

interface WalletProviderContextValue {
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  refreshWallet: () => Promise<void>;
  isFreighterAvailable: boolean;
}

interface WalletProviderProps {
  children: ReactNode;
}

interface FreighterAddressResult {
  address?: string;
  error?: unknown;
}

interface FreighterNetworkResult {
  network?: string;
  networkUrl?: string;
  error?: unknown;
}

interface HorizonBalance {
  balance: string;
  asset_type: "native" | "credit_alphanum4" | "credit_alphanum12" | "liquidity_pool_shares";
  asset_code?: string;
}

const WalletProviderContext = createContext<WalletProviderContextValue | null>(null);

const NETWORK_CHAIN_IDS: Record<string, number> = {
  PUBLIC: 1,
  TESTNET: 2,
  FUTURENET: 3,
  STANDALONE: 4,
};

function normalizeWalletError(error: unknown): string {
  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  if (error && typeof error === "object") {
    if ("message" in error && typeof error.message === "string") {
      return error.message;
    }

    if ("error" in error) {
      return normalizeWalletError(error.error);
    }
  }

  return "Unable to complete the wallet action.";
}

function mapWalletNetwork(networkName: string | undefined): WalletNetwork {
  const normalized = (networkName ?? "UNKNOWN").toUpperCase();

  return {
    chainId: NETWORK_CHAIN_IDS[normalized] ?? 0,
    name: normalized,
    isSupported: normalized in NETWORK_CHAIN_IDS,
  };
}

function getFallbackHorizonUrl(networkName: string | undefined): string {
  const normalized = (networkName ?? "").toUpperCase();

  if (normalized === "PUBLIC") {
    return "https://horizon.stellar.org";
  }

  return "https://horizon-testnet.stellar.org";
}

function mapBalances(balances: HorizonBalance[] | undefined): TokenBalance[] {
  return (balances ?? []).map((balance) => ({
    symbol: balance.asset_type === "native" ? "XLM" : (balance.asset_code ?? "ASSET"),
    amount: balance.balance,
    usdValue: null,
  }));
}

async function loadFreighterApi(): Promise<FreighterApi> {
  return import("@stellar/freighter-api");
}

export function WalletProvider({ children }: WalletProviderProps) {
  const address = useWalletStore((state) => state.address);
  const shouldAutoReconnect = useWalletStore((state) => state.shouldAutoReconnect);
  const setConnected = useWalletStore((state) => state.setConnected);
  const disconnect = useWalletStore((state) => state.disconnect);
  const setBalances = useWalletStore((state) => state.setBalances);
  const setNetwork = useWalletStore((state) => state.setNetwork);
  const setStatus = useWalletStore((state) => state.setStatus);
  const setError = useWalletStore((state) => state.setError);
  const setLoadingBalances = useWalletStore((state) => state.setLoadingBalances);
  const [isFreighterAvailable, setIsFreighterAvailable] = useState(false);
  const syncRef = useRef<Promise<void> | null>(null);

  async function refreshBalances(nextAddress: string, horizonUrl: string, status: WalletStatus) {
    setLoadingBalances(true);

    try {
      const response = await fetch(`${horizonUrl}/accounts/${nextAddress}`);

      if (response.status === 404) {
        setBalances([]);
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch balances from Horizon (${response.status})`);
      }

      const data = (await response.json()) as { balances?: HorizonBalance[] };
      setBalances(mapBalances(data.balances));
      setError(null, status);
    } catch (error) {
      setBalances([]);
      setError(normalizeWalletError(error), status);
    }
  }

  async function syncWallet(interactive: boolean) {
    if (syncRef.current) {
      return syncRef.current;
    }

    const task = (async () => {
      const api = await loadFreighterApi();
      const installationState = await api.isConnected();

      if (installationState.error || !installationState.isConnected) {
        setIsFreighterAvailable(false);
        throw new Error("Freighter is not installed or unavailable in this browser.");
      }

      setIsFreighterAvailable(true);

      const addressResult = (
        interactive ? await api.requestAccess() : await api.getAddress()
      ) as FreighterAddressResult;

      if (addressResult.error) {
        throw new Error(normalizeWalletError(addressResult.error));
      }

      if (!addressResult.address) {
        if (!interactive) {
          disconnect();
          return;
        }

        throw new Error("No Stellar address was returned by Freighter.");
      }

      const freighterApi = api as FreighterApi & {
        getNetworkDetails?: () => Promise<FreighterNetworkResult>;
        getNetwork: () => Promise<FreighterNetworkResult>;
      };
      const networkResult: FreighterNetworkResult = freighterApi.getNetworkDetails
        ? await freighterApi.getNetworkDetails()
        : await freighterApi.getNetwork();

      if (networkResult.error) {
        throw new Error(normalizeWalletError(networkResult.error));
      }

      const walletNetwork = mapWalletNetwork(networkResult.network);
      const nextStatus: WalletStatus = walletNetwork.isSupported ? "connected" : "error";

      setConnected(addressResult.address, walletNetwork);
      setNetwork(walletNetwork);
      setStatus(nextStatus);

      if (!walletNetwork.isSupported) {
        setError(
          `Unsupported wallet network: ${walletNetwork.name}. Switch to PUBLIC, TESTNET, FUTURENET, or STANDALONE.`,
          "error",
        );
      } else {
        setError(null, "connected");
      }

      await refreshBalances(
        addressResult.address,
        networkResult.networkUrl || getFallbackHorizonUrl(networkResult.network),
        nextStatus,
      );
    })()
      .catch((error) => {
        if (interactive) {
          disconnect();
          setError(normalizeWalletError(error), "error");
          throw error;
        }
      })
      .finally(() => {
        syncRef.current = null;
      });

    syncRef.current = task;
    return task;
  }

  async function connectWallet() {
    setStatus("connecting");
    setError(null, "connecting");
    await syncWallet(true);
  }

  function disconnectWallet() {
    disconnect();
  }

  async function refreshWallet() {
    if (!shouldAutoReconnect && !address) {
      return;
    }

    await syncWallet(false);
  }

  useEffect(() => {
    let cancelled = false;

    void loadFreighterApi()
      .then((api) => api.isConnected())
      .then((result) => {
        if (!cancelled) {
          setIsFreighterAvailable(Boolean(result.isConnected && !result.error));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsFreighterAvailable(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!shouldAutoReconnect) {
      return;
    }

    void refreshWallet();
  }, [shouldAutoReconnect]);

  useEffect(() => {
    if (!shouldAutoReconnect) {
      return;
    }

    const syncOnFocus = () => {
      void refreshWallet();
    };

    const syncOnVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshWallet();
      }
    };

    window.addEventListener("focus", syncOnFocus);
    document.addEventListener("visibilitychange", syncOnVisibility);
    const interval = window.setInterval(syncOnFocus, 30_000);

    return () => {
      window.removeEventListener("focus", syncOnFocus);
      document.removeEventListener("visibilitychange", syncOnVisibility);
      window.clearInterval(interval);
    };
  }, [shouldAutoReconnect, address]);

  return (
    <WalletProviderContext.Provider
      value={{
        connectWallet,
        disconnectWallet,
        refreshWallet,
        isFreighterAvailable,
      }}
    >
      {children}
    </WalletProviderContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletProviderContext);

  if (!context) {
    throw new Error("useWallet must be used inside WalletProvider.");
  }

  return context;
}
