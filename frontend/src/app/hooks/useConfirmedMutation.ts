"use client";

import { useState, useCallback } from "react";
import type { TransactionSummaryItem } from "../components/ui/ConfirmTransactionDialog";
import { useToastStore } from "../stores/useToastStore";

interface ConfirmedMutationOptions<TVariables> {
  /** Build the summary rows from the mutation variables. */
  buildSummary?: (variables: TVariables) => TransactionSummaryItem[];
  /** Dialog title. */
  title?: string;
  /** Dialog description / warning text. */
  description?: string;
  /** Label for the confirm button. */
  confirmLabel?: string;
  /** Optional callback invoked when the action rejects. */
  onError?: (error: Error) => void;
  /** Optional callback invoked when the action resolves successfully. */
  onSuccess?: () => void;
}

/**
 * Wraps any async mutation with a confirmation dialog flow.
 *
 * Usage:
 * ```tsx
 * const { dialogProps, trigger, isLoading, error } = useConfirmedMutation(
 *   (vars) => approveLoanMutation.mutateAsync(vars),
 *   {
 *     title: "Approve Loan",
 *     buildSummary: (vars) => [
 *       { label: "Loan ID", value: String(vars.loanId) },
 *       { label: "Amount",  value: `${vars.amount} USDC` },
 *     ],
 *   },
 * );
 *
 * // Render the dialog using dialogProps, trigger on button click:
 * <button onClick={() => trigger(variables)}>Approve</button>
 * <ConfirmTransactionDialog {...dialogProps} />
 * ```
 */
export function useConfirmedMutation<TVariables>(
  action: (variables: TVariables) => Promise<unknown>,
  options: ConfirmedMutationOptions<TVariables> = {},
) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingVariables, setPendingVariables] = useState<TVariables | null>(null);
  const [summary, setSummary] = useState<TransactionSummaryItem[]>([]);

  const trigger = useCallback(
    (variables: TVariables) => {
      setPendingVariables(variables);
      setSummary(options.buildSummary ? options.buildSummary(variables) : []);
      setError(null);
      setIsOpen(true);
    },
    [options],
  );

  const handleConfirm = useCallback(async () => {
    if (pendingVariables === null) return;
    setIsLoading(true);
    setError(null);
    try {
      await action(pendingVariables);
      setIsLoading(false);
      setIsOpen(false);
      setPendingVariables(null);
      setError(null);
      options.onSuccess?.();
    } catch (err: unknown) {
      const errObj = err instanceof Error ? err : new Error(String(err || "Action failed"));
      setError(errObj.message);
      setIsLoading(false);
      useToastStore.getState().addToast({
        type: "error",
        title: "Action Failed",
        description: errObj.message,
      });
      options.onError?.(errObj);
      // Keep modal open so the user can see the error, review variables, and retry or cancel
    }
  }, [action, pendingVariables, options]);

  const handleClose = useCallback(() => {
    if (isLoading) return; // block dismiss while tx is in-flight
    setIsOpen(false);
    setPendingVariables(null);
    setError(null);
  }, [isLoading]);

  return {
    /** Spread onto <ConfirmTransactionDialog> */
    dialogProps: {
      isOpen,
      onClose: handleClose,
      onConfirm: handleConfirm,
      title: options.title,
      description: options.description,
      confirmLabel: options.confirmLabel,
      summary,
      isLoading,
      error,
    },
    /** Call with mutation variables to open the dialog */
    trigger,
    isLoading,
    error,
    clearError: () => setError(null),
  };
}
