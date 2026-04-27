"use client";

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { useState, useEffect } from "react";

export type TransactionStatus =
  | "idle"
  | "pending"
  | "signing"
  | "submitted"
  | "confirming"
  | "confirmed"
  | "failed";

export interface TransactionState {
  id: string;
  status: TransactionStatus;
  message: string;
  progress?: number;
  error?: string;
  txHash?: string;
  startTime: number;
  confirmedAt?: number;
}

interface OptimisticUIState {
  transactions: Record<string, TransactionState>;
  optimisticUpdates: Set<string>;
}

interface OptimisticUIActions {
  startTransaction: (id: string, message: string) => void;
  updateProgress: (id: string, progress: number, message?: string) => void;
  completeTransaction: (id: string, txHash?: string, message?: string) => void;
  submitTransaction: (id: string, txHash: string, message?: string) => void;
  confirmTransaction: (id: string, message?: string) => void;
  signTransaction: (id: string, message?: string) => void;
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
              status: "signing",
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
                status: "confirmed",
                progress: 100,
                txHash,
                confirmedAt: Date.now(),
                ...(message ? { message } : {}),
              },
            },
          };
        }),

      // New: Mark transaction as submitted (waiting for confirmation)
      submitTransaction: (id, txHash, message) =>
        set((state) => {
          const tx = state.transactions[id];
          if (!tx) return state;
          return {
            transactions: {
              ...state.transactions,
              [id]: {
                ...tx,
                status: "submitted",
                progress: 70,
                txHash,
                ...(message ? { message } : {}),
              },
            },
          };
        }),

      // New: Mark transaction as confirming (polling for confirmation)
      confirmTransaction: (id, message) =>
        set((state) => {
          const tx = state.transactions[id];
          if (!tx) return state;
          return {
            transactions: {
              ...state.transactions,
              [id]: {
                ...tx,
                status: "confirming",
                progress: 90,
                ...(message ? { message } : {}),
              },
            },
          };
        }),

      // New: Mark transaction as signing (waiting for wallet)
      signTransaction: (id, message) =>
        set((state) => {
          const tx = state.transactions[id];
          if (!tx) return state;
          return {
            transactions: {
              ...state.transactions,
              [id]: {
                ...tx,
                status: "signing",
                progress: 40,
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
                status: "failed",
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

  // Auto-dismiss confirmed transactions after 3 seconds
  useEffect(() => {
    if (transaction?.status === "confirmed" && transaction.confirmedAt) {
      const timeSinceConfirmed = Date.now() - transaction.confirmedAt;
      if (timeSinceConfirmed < 3000) {
        const timeout = setTimeout(() => {
          store.clearTransaction(id);
        }, 3000 - timeSinceConfirmed);
        return () => clearTimeout(timeout);
      } else if (timeSinceConfirmed >= 3000) {
        // Already past 3 seconds, clear immediately
        store.clearTransaction(id);
      }
    }
  }, [transaction?.status, transaction?.confirmedAt, id, store]);

  return {
    transaction,
    start: (message: string) => store.startTransaction(id, message),
    updateProgress: (progress: number, message?: string) =>
      store.updateProgress(id, progress, message),
    complete: (txHash?: string, message?: string) => store.completeTransaction(id, txHash, message),
    submit: (txHash: string, message?: string) => store.submitTransaction(id, txHash, message),
    confirm: (message?: string) => store.confirmTransaction(id, message),
    sign: (message?: string) => store.signTransaction(id, message),
    fail: (error: string) => store.failTransaction(id, error),
    clear: () => store.clearTransaction(id),
    isLoading: transaction?.status === "pending" || transaction?.status === "signing",
    isSigning: transaction?.status === "signing",
    isSubmitted: transaction?.status === "submitted",
    isConfirming: transaction?.status === "confirming",
    isSuccess: transaction?.status === "confirmed",
    isError: transaction?.status === "failed",
  };
}
