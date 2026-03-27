"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { requestAccess, getNetwork, isConnected, signTransaction } from "@stellar/freighter-api";
import { Horizon } from "@stellar/stellar-sdk";
import { useWalletStore, type TokenBalance, type WalletNetwork } from "../../stores/useWalletStore";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WalletContextType {
  /** Initiates wallet connection flow */
  connect: () => Promise<void>;
  /** Disconnects wallet and clears state */
  disconnect: () => void;
  /** Signs a transaction using Freighter */
  signTransaction: (xdr: string) => Promise<string>;
  /** True while connecting */
  isConnecting: boolean;
  /** Connection error message */
  connectionError: string | null;
}

const WalletContext = createContext<WalletContextType | null>(null);

// ─── Constants ───────────────────────────────────────────────────────────────

const SUPPORTED_NETWORKS: Record<string, { name: string; horizonUrl: string }> = {
  "Test SDF Network ; September 2015": {
    name: "Testnet",
    horizonUrl: "https://horizon-testnet.stellar.org",
  },
  "Public Global Stellar Network ; September 2015": {
    name: "Mainnet",
    horizonUrl: "https://horizon.stellar.org",
  },
  Testnet: {
    name: "Testnet",
    horizonUrl: "https://horizon-testnet.stellar.org",
  },
  Public: {
    name: "Mainnet",
    horizonUrl: "https://horizon.stellar.org",
  },
};

const LOCAL_STORAGE_KEY = "remitlend-wallet-connected";

// ─── Helper Functions ─────────────────────────────────────────────────────────

function truncateAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function getNetworkInfo(networkPassphrase: string): WalletNetwork & { horizonUrl: string } {
  const supported = SUPPORTED_NETWORKS[networkPassphrase];
  const isSupported = !!supported;

  // Generate a numeric chainId for compatibility (hash of network passphrase)
  // This ensures EVM-style chainId compatibility in the store
  const chainId = networkPassphrase.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);

  return {
    chainId,
    name: supported?.name || networkPassphrase.slice(0, 20),
    isSupported,
    horizonUrl: supported?.horizonUrl || "https://horizon-testnet.stellar.org",
  };
}

async function fetchBalances(publicKey: string, horizonUrl: string): Promise<TokenBalance[]> {
  try {
    const server = new Horizon.Server(horizonUrl);
    const account = await server.loadAccount(publicKey);

    const balances: TokenBalance[] = account.balances.map((balance) => {
      if (balance.asset_type === "native") {
        return {
          symbol: "XLM",
          amount: balance.balance,
          usdValue: null,
        };
      }
      // For credit_alphanum4 and credit_alphanum12 assets
      if ("asset_code" in balance) {
        return {
          symbol: balance.asset_code || "UNKNOWN",
          amount: balance.balance,
          usdValue: null,
        };
      }
      // For liquidity pool or other types
      return {
        symbol: "LP",
        amount: balance.balance,
        usdValue: null,
      };
    });

    return balances;
  } catch (error) {
    console.error("Failed to fetch balances:", error);
    return [];
  }
}

// ─── Provider Component ───────────────────────────────────────────────────────

interface WalletProviderProps {
  children: ReactNode;
}

export function WalletProvider({ children }: WalletProviderProps) {
  const store = useWalletStore();
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);

  // Mark as client-side mounted
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Check for existing connection on mount
  useEffect(() => {
    if (!isClient) return;

    const checkExistingConnection = async () => {
      const wasConnected = localStorage.getItem(LOCAL_STORAGE_KEY) === "true";
      if (!wasConnected) return;

      try {
        const connected = await isConnected();
        if (!connected) {
          localStorage.removeItem(LOCAL_STORAGE_KEY);
          return;
        }

        // In Freighter API v6, requestAccess returns { address: string }
        const result = await requestAccess();
        const publicKey = result.address;
        if (!publicKey) {
          localStorage.removeItem(LOCAL_STORAGE_KEY);
          return;
        }

        const networkResult = await getNetwork();
        const networkPassphrase = networkResult.networkPassphrase;
        const networkInfo = getNetworkInfo(networkPassphrase);

        store.setConnected(publicKey, {
          chainId: networkInfo.chainId,
          name: networkInfo.name,
          isSupported: networkInfo.isSupported,
        });

        // Fetch balances
        const balances = await fetchBalances(publicKey, networkInfo.horizonUrl);
        store.setBalances(balances);
      } catch (error) {
        console.error("Failed to restore wallet connection:", error);
        localStorage.removeItem(LOCAL_STORAGE_KEY);
      }
    };

    checkExistingConnection();
  }, [isClient, store]);

  // Listen for account changes
  useEffect(() => {
    if (!isClient || store.status !== "connected") return;

    const handleAccountChange = async () => {
      try {
        // Re-request access to get current account
        const result = await requestAccess();
        const newPublicKey = result.address;
        if (newPublicKey !== store.address) {
          // Account changed, update store
          const networkResult = await getNetwork();
          const networkPassphrase = networkResult.networkPassphrase;
          const networkInfo = getNetworkInfo(networkPassphrase);

          store.setConnected(newPublicKey, {
            chainId: networkInfo.chainId,
            name: networkInfo.name,
            isSupported: networkInfo.isSupported,
          });

          const balances = await fetchBalances(newPublicKey, networkInfo.horizonUrl);
          store.setBalances(balances);
        }
      } catch (error) {
        console.error("Error checking account changes:", error);
      }
    };

    // Poll for account changes every 3 seconds
    const interval = setInterval(handleAccountChange, 3000);
    return () => clearInterval(interval);
  }, [isClient, store, store.status, store.address]);

  const connect = useCallback(async () => {
    setConnectionError(null);
    setIsConnecting(true);
    store.setStatus("connecting");

    try {
      // Check if Freighter is installed
      const freighterConnected = await isConnected();
      if (!freighterConnected) {
        throw new Error(
          "Freighter wallet not found. Please install the Freighter browser extension.",
        );
      }

      // Request access to wallet (returns { address: string } in v6)
      const result = await requestAccess();
      const publicKey = result.address;
      if (!publicKey) {
        throw new Error("No public key returned from wallet");
      }

      // Get network info
      const networkResult = await getNetwork();
      const networkPassphrase = networkResult.networkPassphrase;
      const networkInfo = getNetworkInfo(networkPassphrase);

      if (!networkInfo.isSupported) {
        throw new Error(
          `Unsupported network: ${networkPassphrase}. Please switch to Testnet or Mainnet in Freighter settings.`,
        );
      }

      // Update store
      store.setConnected(publicKey, {
        chainId: networkInfo.chainId,
        name: networkInfo.name,
        isSupported: networkInfo.isSupported,
      });

      // Persist connection state
      localStorage.setItem(LOCAL_STORAGE_KEY, "true");

      // Fetch balances
      store.setLoadingBalances(true);
      const balances = await fetchBalances(publicKey, networkInfo.horizonUrl);
      store.setBalances(balances);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to connect wallet";
      setConnectionError(errorMessage);
      store.setError(errorMessage);
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    } finally {
      setIsConnecting(false);
    }
  }, [store]);

  const disconnect = useCallback(() => {
    store.disconnect();
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    setConnectionError(null);
  }, [store]);

  const handleSignTransaction = useCallback(
    async (xdr: string): Promise<string> => {
      try {
        const result = await signTransaction(xdr, {
          networkPassphrase:
            store.network?.name === "Mainnet"
              ? "Public Global Stellar Network ; September 2015"
              : "Test SDF Network ; September 2015",
        });
        return result.signedTxXdr;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to sign transaction";
        throw new Error(errorMessage);
      }
    },
    [store.network?.name],
  );

  const value: WalletContextType = {
    connect,
    disconnect,
    signTransaction: handleSignTransaction,
    isConnecting,
    connectionError,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useWallet(): WalletContextType {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
