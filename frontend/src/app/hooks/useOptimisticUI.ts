/**
 * hooks/useOptimisticUI.ts
 *
 * Provides utilities for managing optimistic UI state during transactions.
 * Handles loading states, transaction progress, and error recovery.
 *
 * Usage Example:
 * ```tsx
 * const ui = useOptimisticUI();
 *
 * const handleTransaction = async () => {
 *   ui.startTransaction("depositPool", "Depositing 100 USDC");
 *   try {
 *     await executeDeposit();
 *     ui.completeTransaction("depositPool");
 *   } catch (error) {
 *     ui.failTransaction("depositPool", error.message);
 *   }
 * };
 * ```
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";

export type TransactionStatus = "idle" | "pending" | "success" | "error";

export interface TransactionState {
  id: string;
  status: TransactionStatus;
  message: string;
  progress?: number; // 0-100 for multi-step transactions
  error?: string;
  txHash?: string;
  startTime: number;
}

interface OptimisticUIState {
  /** Map of transaction ID to its state */
  transactions: Record<string, TransactionState>;
  /** Track which data keys are being optimistically updated */
  optimisticUpdates: Set<string>;
}

interface OptimisticUIActions {
  /** Start tracking a new transaction */
  startTransaction: (id: string, message: string) => void;
  /** Update progress for a transaction (0-100) */
  updateProgress: (id: string, progress: number) => void;
  /** Mark transaction as complete */
  completeTransaction: (id: string, txHash?: string) => void;
  /** Mark transaction as failed */
  failTransaction: (id: string, error: string) => void;
  /** Clear a transaction from state */
  clearTransaction: (id: string) => void;
  /** Clear all transactions */
  clearAllTransactions: () => void;
  /** Track that we're optimistically updating a data key */
  addOptimisticUpdate: (key: string) => void;
  /** Untrack an optimistic update */
  removeOptimisticUpdate: (key: string) => void;
  /** Check if a data key is being optimistically updated */
  isOptimisticUpdate: (key: string) => boolean;
  /** Get transaction state by ID */
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

      updateProgress: (id, progress) =>
        set((state) => ({
          transactions: {
            ...state.transactions,
            [id]: {
              ...state.transactions[id],
              progress: Math.min(100, Math.max(0, progress)),
            },
          },
        })),

      completeTransaction: (id, txHash) =>
        set((state) => ({
          transactions: {
            ...state.transactions,
            [id]: {
              ...state.transactions[id],
              status: "success",
              progress: 100,
              txHash,
            },
          },
        })),

      failTransaction: (id, error) =>
        set((state) => ({
          transactions: {
            ...state.transactions,
            [id]: {
              ...state.transactions[id],
              status: "error",
              error,
            },
          },
        })),

      clearTransaction: (id) =>
        set((state) => {
          const { [id]: _, ...rest } = state.transactions;
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

      isOptimisticUpdate: (key) => {
        return get().optimisticUpdates.has(key);
      },

      getTransaction: (id) => {
        return get().transactions[id];
      },
    }),
    { name: "OptimisticUIStore" },
  ),
);

/**
 * Helper hook to track a single transaction
 */
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
