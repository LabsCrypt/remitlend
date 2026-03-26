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
import { useCallback, useRef } from "react";
import { useGamificationStore } from "../stores/useGamificationStore";

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

  const {
    pendingMessage = "Processing transaction...",
    successMessage = "Transaction successful!",
    errorMessage = "Transaction failed",
    network = "testnet",
    disableToast = false,
    gamificationXP,
    gamificationReason,
    gamificationAchievement,
  } = options;

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

  const mutate = useCallback(
    (variables: TVariables, mutationOptions?: Parameters<typeof mutation.mutate>[1]) => {
      if (!disableToast) {
        toastIdRef.current = toast.showPending(pendingMessage);
      }

      mutation.mutate(variables, {
        ...mutationOptions,
        onSuccess: (data, vars, onMutateResult, context) => {
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
          if (!disableToast && toastIdRef.current !== null) {
            toast.showError(toastIdRef.current, {
              errorMessage: error instanceof Error ? error.message : errorMessage,
            });
          }
          mutationOptions?.onError?.(error, vars, onMutateResult, context);
        },
      });
    },
    [mutation, toast, pendingMessage, successMessage, errorMessage, network, disableToast],
  );

  const mutateAsync = useCallback(
    async (variables: TVariables, mutationOptions?: Parameters<typeof mutation.mutateAsync>[1]) => {
      if (!disableToast) {
        toastIdRef.current = toast.showPending(pendingMessage);
      }

      try {
        const data = await mutation.mutateAsync(variables, mutationOptions);

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
        if (!disableToast && toastIdRef.current !== null) {
          toast.showError(toastIdRef.current, {
            errorMessage: error instanceof Error ? error.message : errorMessage,
          });
        }
        throw error;
      }
    },
    [mutation, toast, pendingMessage, successMessage, errorMessage, network, disableToast],
  );

  return {
    ...mutation,
    mutate,
    mutateAsync,
  };
}
