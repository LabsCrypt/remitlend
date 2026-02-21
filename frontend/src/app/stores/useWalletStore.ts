/**
 * stores/useWalletStore.ts
 *
 * Zustand store for Web3 wallet connection state.
 *
 * Responsibilities:
 *  - Track the connected wallet address
 *  - Track the current chain / network
 *  - Track available token balances
 *  - Provide actions to connect / disconnect
 *
 * Design decision: actual wallet provider interaction (ethers / wagmi calls)
 * lives in a separate hook or service. This store is the single source of truth
 * for the resulting state so any component can read it without a provider tree.
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";

// ─── Types ───────────────────────────────────────────────────────────────────

export type WalletStatus =
    | "disconnected"
    | "connecting"
    | "connected"
    | "error";

export interface TokenBalance {
    symbol: string;
    /** Human-readable amount, e.g. "1.234" */
    amount: string;
    /** USD value, or null if price unavailable */
    usdValue: number | null;
}

export interface WalletNetwork {
    chainId: number;
    name: string;
    /** Whether this is one of the app's supported networks */
    isSupported: boolean;
}

interface WalletState {
    /** Wallet connection status */
    status: WalletStatus;
    /** Connected wallet address (checksummed) — null when disconnected */
    address: string | null;
    /** Current network info */
    network: WalletNetwork | null;
    /** Token balances for the connected wallet */
    balances: TokenBalance[];
    /** True while fetching/refreshing balances */
    isLoadingBalances: boolean;
    /** Human-readable error message */
    error: string | null;
}

interface WalletActions {
    /** Call after a successful wallet.connect() to store the result */
    setConnected: (address: string, network: WalletNetwork) => void;
    /** Call on disconnect or user-initiated Sign Out with wallet */
    disconnect: () => void;
    /** Update balances after fetching from the chain */
    setBalances: (balances: TokenBalance[]) => void;
    /** Update network when the user switches chains */
    setNetwork: (network: WalletNetwork) => void;
    setStatus: (status: WalletStatus) => void;
    setError: (error: string | null) => void;
    setLoadingBalances: (loading: boolean) => void;
}

export type WalletStore = WalletState & WalletActions;

// ─── Initial state ────────────────────────────────────────────────────────────

const initialState: WalletState = {
    status: "disconnected",
    address: null,
    network: null,
    balances: [],
    isLoadingBalances: false,
    error: null,
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useWalletStore = create<WalletStore>()(
    devtools(
        (set) => ({
            ...initialState,

            setConnected: (address, network) =>
                set(
                    {
                        status: "connected",
                        address,
                        network,
                        error: null,
                    },
                    false,
                    "wallet/setConnected",
                ),

            disconnect: () =>
                set({ ...initialState }, false, "wallet/disconnect"),

            setBalances: (balances) =>
                set(
                    { balances, isLoadingBalances: false },
                    false,
                    "wallet/setBalances",
                ),

            setNetwork: (network) =>
                set({ network }, false, "wallet/setNetwork"),

            setStatus: (status) =>
                set({ status }, false, "wallet/setStatus"),

            setError: (error) =>
                set(
                    { error, status: "error", isLoadingBalances: false },
                    false,
                    "wallet/setError",
                ),

            setLoadingBalances: (isLoadingBalances) =>
                set({ isLoadingBalances }, false, "wallet/setLoadingBalances"),
        }),
        { name: "WalletStore" },
    ),
);

// ─── Selectors ────────────────────────────────────────────────────────────────

export const selectWalletAddress = (state: WalletStore) => state.address;
export const selectWalletStatus = (state: WalletStore) => state.status;
export const selectIsWalletConnected = (state: WalletStore) =>
    state.status === "connected";
export const selectWalletNetwork = (state: WalletStore) => state.network;
export const selectWalletBalances = (state: WalletStore) => state.balances;
export const selectWalletError = (state: WalletStore) => state.error;
