/**
 * hooks/useContractMutation.ts
 *
 * Wrapper hook that combines TanStack Query mutations with automatic toast notifications.
 * Provides a consistent pattern for handling blockchain transactions with user feedback.
 *
 * Usage Example:
 * ```tsx
 * const createLoan = useContractMutation(useCreateLoan(), {
 *   pendingMessage: "Creating loan...",
 *   successMessage: "Loan created successfully!",
 *   errorMessage: "Failed to create loan",
 * });
 *
 * // In your component
 * createLoan.mutate({ amount: 1000, ... });
 * ```
 */

import { type UseMutationResult } from "@tanstack/react-query";
import { useContractToast } from "./useContractToast";
import { useCallback, useRef, useState } from "react";
import { useGamificationStore } from "../stores/useGamificationStore";
import { pollTransactionStatus } from "../utils/transactionErrors";

export type TransactionLifecycleState =
  | "idle"
  | "pending"
  | "submitted"
  | "confirming"
  | "confirmed"
  | "failed"
  | "cancelled";

interface ContractMutationOptions {
  /** Message shown during pending state */
  pendingMessage?: string;
  /** Message shown on success */
  successMessage?: string;
  /** Message shown on error */
  errorMessage?: string;
  /** Stellar network for explorer links */
  network?: "testnet" | "public";
  /** Disable automatic toast notifications */
  disableToast?: boolean;
  /** Gamification XP to award on success */
  gamificationXP?: number;
  /** Gamification reason for XP */
  gamificationReason?: string;
  /** Gamification achievement ID to unlock on success */
  gamificationAchievement?: string;
  /** Callback for state changes */
  onStateChange?: (state: TransactionLifecycleState, txHash?: string) => void;
  /** Enable enhanced polling */
  enableEnhancedPolling?: boolean;
}

/**
 * Wraps a TanStack Query mutation with automatic toast notifications.
 * Handles the full transaction lifecycle: pending → success/error.
 */
export function useContractMutation<TData extends { txHash?: string }, TError, TVariables>(
  mutation: UseMutationResult<TData, TError, TVariables>,
  options: ContractMutationOptions = {},
) {
  const toast = useContractToast();
  const gamificationStore = useGamificationStore();
  const toastIdRef = useRef<string | number | null>(null);
  const [lifecycleState, setLifecycleState] = useState<TransactionLifecycleState>("idle");
  const [currentTxHash, setCurrentTxHash] = useState<string | undefined>();
  const pollingControllerRef = useRef<AbortController | null>(null);

  const {
    pendingMessage = "Processing transaction...",
    successMessage = "Transaction successful!",
    errorMessage = "Transaction failed",
    network = "testnet",
    disableToast = false,
    gamificationXP,
    gamificationReason,
    gamificationAchievement,
    onStateChange,
    enableEnhancedPolling = true,
  } = options;

  const updateState = useCallback(
    (state: TransactionLifecycleState, txHash?: string) => {
      setLifecycleState(state);
      setCurrentTxHash(txHash);
      onStateChange?.(state, txHash);
    },
    [onStateChange],
  );

  const startEnhancedPolling = useCallback(
    async (txHash: string) => {
      if (!enableEnhancedPolling) return;

      updateState("submitted", txHash);

      const controller = new AbortController();
      pollingControllerRef.current = controller;

      try {
        // Wait a bit before starting to poll to allow transaction to propagate
        await new Promise((resolve) => setTimeout(resolve, 1000));

        updateState("confirming", txHash);

        const pollResult = await pollTransactionStatus(txHash, {
          signal: controller.signal,
          intervalMs: 2000,
          timeoutMs: 60000, // 60 seconds timeout
        });

        pollingControllerRef.current = null;

        if (pollResult.status === "success") {
          updateState("confirmed", txHash);
        } else if (pollResult.status === "failed") {
          updateState("failed", txHash);
        } else {
          // Timeout or cancelled - transaction might still be processing
          updateState("confirming", txHash);
        }
      } catch (error) {
        pollingControllerRef.current = null;
        if (!controller.signal.aborted) {
          updateState("failed", txHash);
        }
      }
    },
    [enableEnhancedPolling, updateState],
  );

  const triggerGamification = useCallback(() => {
    if (gamificationXP) {
      // Small delay to let the toast appear first
      setTimeout(() => {
        gamificationStore.addXP(gamificationXP, gamificationReason);
        if (gamificationAchievement) {
          gamificationStore.unlockAchievement(gamificationAchievement);
        }
      }, 500);
    } else if (gamificationAchievement) {
      setTimeout(() => {
        gamificationStore.unlockAchievement(gamificationAchievement);
      }, 500);
    }
  }, [gamificationXP, gamificationReason, gamificationAchievement, gamificationStore]);

  const mutate = (
    variables: TVariables,
    mutationOptions?: Parameters<typeof mutation.mutate>[1],
  ) => {
    updateState("pending");

    if (!disableToast) {
      toastIdRef.current = toast.showPending(pendingMessage);
    }

    mutation.mutate(variables, {
      ...mutationOptions,
      onSuccess: (data, vars, onMutateResult, context) => {
        if (data.txHash && enableEnhancedPolling) {
          startEnhancedPolling(data.txHash);
        } else {
          updateState("confirmed", data.txHash);
        }

        if (!disableToast && toastIdRef.current !== null) {
          toast.showSuccess(toastIdRef.current, {
            successMessage,
            txHash: data.txHash,
            network,
          });
        }

        triggerGamification();
        mutationOptions?.onSuccess?.(data, vars, onMutateResult, context);
      },
      onError: (error, vars, onMutateResult, context) => {
        updateState("failed");

        if (!disableToast && toastIdRef.current !== null) {
          toast.showError(toastIdRef.current, {
            errorMessage: error instanceof Error ? error.message : errorMessage,
          });
        }
        mutationOptions?.onError?.(error, vars, onMutateResult, context);
      },
    });
  };

  const mutateAsync = async (
    variables: TVariables,
    mutationOptions?: Parameters<typeof mutation.mutateAsync>[1],
  ) => {
    updateState("pending");

    if (!disableToast) {
      toastIdRef.current = toast.showPending(pendingMessage);
    }

    try {
      const data = await mutation.mutateAsync(variables, mutationOptions);

      if (data.txHash && enableEnhancedPolling) {
        await startEnhancedPolling(data.txHash);
      } else {
        updateState("confirmed", data.txHash);
      }

      if (!disableToast && toastIdRef.current !== null) {
        toast.showSuccess(toastIdRef.current, {
          successMessage,
          txHash: data.txHash,
          network,
        });
      }

      triggerGamification();

      return data;
    } catch (error) {
      updateState("failed");

      if (!disableToast && toastIdRef.current !== null) {
        toast.showError(toastIdRef.current, {
          errorMessage: error instanceof Error ? error.message : errorMessage,
        });
      }
      throw error;
    }
  };

  return {
    ...mutation,
    mutate,
    mutateAsync,
    lifecycleState,
    txHash: currentTxHash,
    cancelPolling: () => {
      pollingControllerRef.current?.abort();
      updateState("cancelled");
    },
  };
}
