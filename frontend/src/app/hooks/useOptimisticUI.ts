"use client";

import { create } from "zustand";
import { devtools } from "zustand/middleware";

export type TransactionStatus = "idle" | "pending" | "success" | "error";

export interface TransactionState {
  id: string;
  status: TransactionStatus;
  message: string;
  progress?: number;
  error?: string;
  txHash?: string;
  startTime: number;
}

interface OptimisticUIState {
  transactions: Record<string, TransactionState>;
  optimisticUpdates: Set<string>;
}

interface OptimisticUIActions {
  startTransaction: (id: string, message: string) => void;
  updateProgress: (id: string, progress: number, message?: string) => void;
  completeTransaction: (id: string, txHash?: string, message?: string) => void;
  failTransaction: (id: string, error: string) => void;
  clearTransaction: (id: string) => void;
  clearAllTransactions: () => void;
  addOptimisticUpdate: (key: string) => void;
  removeOptimisticUpdate: (key: string) => void;
  isOptimisticUpdate: (key: string) => boolean;
  getTransaction: (id: string) => TransactionState | undefined;
}

export type OptimisticUIStore = OptimisticUIState & OptimisticUIActions;

export const useOptimisticUI = create<OptimisticUIStore>()(
  devtools(
    (set, get) => ({
      transactions: {},
      optimisticUpdates: new Set(),

      startTransaction: (id, message) =>
        set((state) => ({
          transactions: {
            ...state.transactions,
            [id]: {
              id,
              status: "pending",
              message,
              progress: 0,
              startTime: Date.now(),
            },
          },
        })),

      updateProgress: (id, progress, message) =>
        set((state) => {
          const tx = state.transactions[id];
          if (!tx) return state;
          return {
            transactions: {
              ...state.transactions,
              [id]: {
                ...tx,
                progress: Math.min(100, Math.max(0, progress)),
                ...(message ? { message } : {}),
              },
            },
          };
        }),

      completeTransaction: (id, txHash, message) =>
        set((state) => {
          const tx = state.transactions[id];
          if (!tx) return state;
          return {
            transactions: {
              ...state.transactions,
              [id]: {
                ...tx,
                status: "success",
                progress: 100,
                txHash,
                ...(message ? { message } : {}),
              },
            },
          };
        }),

      failTransaction: (id, error) =>
        set((state) => {
          const tx = state.transactions[id];
          if (!tx) return state;
          return {
            transactions: {
              ...state.transactions,
              [id]: {
                ...tx,
                status: "error",
                error,
              },
            },
          };
        }),

      clearTransaction: (id) =>
        set((state) => {
          const { [id]: _removed, ...rest } = state.transactions;
          return { transactions: rest };
        }),

      clearAllTransactions: () => set({ transactions: {} }),

      addOptimisticUpdate: (key) =>
        set((state) => {
          const updated = new Set(state.optimisticUpdates);
          updated.add(key);
          return { optimisticUpdates: updated };
        }),

      removeOptimisticUpdate: (key) =>
        set((state) => {
          const updated = new Set(state.optimisticUpdates);
          updated.delete(key);
          return { optimisticUpdates: updated };
        }),

      isOptimisticUpdate: (key) => get().optimisticUpdates.has(key),

      getTransaction: (id) => get().transactions[id],
    }),
    { name: "OptimisticUIStore" },
  ),
);

export function useTransaction(id: string) {
  const store = useOptimisticUI();
  const transaction = store.getTransaction(id);

  return {
    transaction,
    start: (message: string) => store.startTransaction(id, message),
    updateProgress: (progress: number) => store.updateProgress(id, progress),
    complete: (txHash?: string) => store.completeTransaction(id, txHash),
    fail: (error: string) => store.failTransaction(id, error),
    clear: () => store.clearTransaction(id),
    isLoading: transaction?.status === "pending",
    isSuccess: transaction?.status === "success",
    isError: transaction?.status === "error",
  };
}
