"use client";

import { useState, useCallback } from "react";
import type { TransactionSummaryItem } from "../components/ui/ConfirmTransactionDialog";

interface ConfirmedMutationOptions<TVariables> {
  /** Build the summary rows from the mutation variables. */
  buildSummary?: (variables: TVariables) => TransactionSummaryItem[];
  /** Dialog title. */
  title?: string;
  /** Dialog description / warning text. */
  description?: string;
  /** Label for the confirm button. */
  confirmLabel?: string;
}

/**
 * Wraps any async mutation with a confirmation dialog flow.
 *
 * Usage:
 * ```tsx
 * const { dialogProps, trigger, isLoading } = useConfirmedMutation(
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
  const [pendingVariables, setPendingVariables] = useState<TVariables | null>(null);
  const [summary, setSummary] = useState<TransactionSummaryItem[]>([]);

  const trigger = useCallback(
    (variables: TVariables) => {
      setPendingVariables(variables);
      setSummary(options.buildSummary ? options.buildSummary(variables) : []);
      setIsOpen(true);
    },
    [options],
  );

  const handleConfirm = useCallback(async () => {
    if (pendingVariables === null) return;
    setIsLoading(true);
    try {
      await action(pendingVariables);
    } finally {
      setIsLoading(false);
      setIsOpen(false);
      setPendingVariables(null);
    }
  }, [action, pendingVariables]);

  const handleClose = useCallback(() => {
    if (isLoading) return; // block dismiss while tx is in-flight
    setIsOpen(false);
    setPendingVariables(null);
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
    },
    /** Call with mutation variables to open the dialog */
    trigger,
    isLoading,
  };
}
