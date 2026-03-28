/**
 * stores/useWalletStore.ts
 *
 * Zustand store for Web3 wallet connection state.
 *
 * Responsibilities:
 *  - Track the connected wallet address and provider type
 *  - Restore persisted wallet sessions after refresh
 *  - Provide actions to connect / disconnect
 *  - Track network and balances derived from the active wallet session
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";

export type WalletStatus = "disconnected" | "connecting" | "connected" | "error";
export type WalletType = "freighter" | "xbull" | "albedo" | "demo";

export interface TokenBalance {
  symbol: string;
  amount: string;
  usdValue: number | null;
}

export interface WalletNetwork {
  chainId: number;
  name: string;
  isSupported: boolean;
}

interface WalletState {
  status: WalletStatus;
  walletType: WalletType | null;
  address: string | null;
  network: WalletNetwork | null;
  balances: TokenBalance[];
  isLoadingBalances: boolean;
  error: string | null;
  hydrated: boolean;
}

interface WalletActions {
  setConnected: (walletType: WalletType, address: string, network: WalletNetwork) => void;
  disconnect: () => void;
  initializeSession: () => void;
  setBalances: (balances: TokenBalance[]) => void;
  setNetwork: (network: WalletNetwork) => void;
  setStatus: (status: WalletStatus) => void;
  setError: (error: string | null) => void;
  setLoadingBalances: (loading: boolean) => void;
}

export type WalletStore = WalletState & WalletActions;

const WALLET_STORAGE_KEY = "remitlend.wallet-session";

interface PersistedWalletSession {
  walletType: WalletType;
  address: string;
  network: WalletNetwork;
}

function isWalletType(value: unknown): value is WalletType {
  return value === "freighter" || value === "xbull" || value === "albedo" || value === "demo";
}

function readStoredWalletSession(): PersistedWalletSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(WALLET_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedWalletSession>;
    if (
      !isWalletType(parsed.walletType) ||
      typeof parsed.address !== "string" ||
      typeof parsed.network?.chainId !== "number" ||
      typeof parsed.network?.name !== "string" ||
      typeof parsed.network?.isSupported !== "boolean"
    ) {
      window.localStorage.removeItem(WALLET_STORAGE_KEY);
      return null;
    }

    return {
      walletType: parsed.walletType,
      address: parsed.address,
      network: parsed.network,
    };
  } catch {
    window.localStorage.removeItem(WALLET_STORAGE_KEY);
    return null;
  }
}

function writeStoredWalletSession(session: PersistedWalletSession) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(session));
}

function clearStoredWalletSession() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(WALLET_STORAGE_KEY);
}

const initialState: WalletState = {
  status: "disconnected",
  walletType: null,
  address: null,
  network: null,
  balances: [],
  isLoadingBalances: false,
  error: null,
  hydrated: false,
};

export const useWalletStore = create<WalletStore>()(
  devtools(
    (set) => ({
      ...initialState,

      setConnected: (walletType, address, network) => {
        writeStoredWalletSession({ walletType, address, network });

        set(
          {
            status: "connected",
            walletType,
            address,
            network,
            error: null,
            hydrated: true,
          },
          false,
          "wallet/setConnected",
        );
      },

      disconnect: () => {
        clearStoredWalletSession();
        set({ ...initialState, hydrated: true }, false, "wallet/disconnect");
      },

      initializeSession: () => {
        const storedSession = readStoredWalletSession();

        if (!storedSession) {
          set({ hydrated: true }, false, "wallet/initializeSession");
          return;
        }

        set(
          {
            status: "connected",
            walletType: storedSession.walletType,
            address: storedSession.address,
            network: storedSession.network,
            error: null,
            hydrated: true,
          },
          false,
          "wallet/initializeSession",
        );
      },

      setBalances: (balances) =>
        set({ balances, isLoadingBalances: false }, false, "wallet/setBalances"),

      setNetwork: (network) => {
        set(
          (state) => {
            if (state.walletType && state.address) {
              writeStoredWalletSession({
                walletType: state.walletType,
                address: state.address,
                network,
              });
            }

            return { network };
          },
          false,
          "wallet/setNetwork",
        );
      },

      setStatus: (status) => set({ status }, false, "wallet/setStatus"),

      setError: (error) =>
        set({ error, status: "error", isLoadingBalances: false }, false, "wallet/setError"),

      setLoadingBalances: (isLoadingBalances) =>
        set({ isLoadingBalances }, false, "wallet/setLoadingBalances"),
    }),
    { name: "WalletStore" },
  ),
);

export const selectWalletAddress = (state: WalletStore) => state.address;
export const selectWalletStatus = (state: WalletStore) => state.status;
export const selectIsWalletConnected = (state: WalletStore) => state.status === "connected";
export const selectWalletType = (state: WalletStore) => state.walletType;
export const selectWalletNetwork = (state: WalletStore) => state.network;
export const selectWalletBalances = (state: WalletStore) => state.balances;
export const selectWalletError = (state: WalletStore) => state.error;
export const selectWalletHydrated = (state: WalletStore) => state.hydrated;
