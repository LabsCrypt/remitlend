/**
 * hooks/useTransactionPreview.ts
 *
 * Hook for managing transaction preview modal state and data.
 * Provides a consistent interface for showing transaction details before signing.
 *
 * Usage Example:
 * ```tsx
 * const txPreview = useTransactionPreview();
 *
 * // Show preview before transaction
 * txPreview.show({
 *   operations: [{ type: "Deposit", description: "You are depositing 100 USDC", amount: "100", token: "USDC" }],
 *   balanceChanges: [{ token: "USDC", change: "-100", isPositive: false }],
 *   estimatedGasFee: "0.00001",
 *   network: "Stellar Testnet"
 * }, async () => {
 *   // Execute transaction after user confirms
 *   await executeTransaction();
 * });
 * ```
 */

import { useState, useCallback } from "react";
import type { TransactionPreviewData } from "../components/transaction/TransactionPreviewModal";

interface UseTransactionPreviewReturn {
  /** Whether the preview modal is open */
  isOpen: boolean;
  /** Transaction data to display */
  data: TransactionPreviewData | null;
  /** Whether a transaction is being processed */
  isLoading: boolean;
  /** Show the preview modal with transaction data */
  show: (data: TransactionPreviewData, onConfirm: () => Promise<void>) => void;
  /** Close the preview modal */
  close: () => void;
  /** Confirm and execute the transaction */
  confirm: () => Promise<void>;
}

export function useTransactionPreview(): UseTransactionPreviewReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<TransactionPreviewData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [onConfirmCallback, setOnConfirmCallback] = useState<(() => Promise<void>) | null>(null);

  const show = useCallback(
    (previewData: TransactionPreviewData, onConfirm: () => Promise<void>) => {
      setData(previewData);
      setOnConfirmCallback(() => onConfirm);
      setIsOpen(true);
    },
    [],
  );

  const close = useCallback(() => {
    setIsOpen(false);
    setIsLoading(false);
    // Clear data after animation completes
    setTimeout(() => {
      setData(null);
      setOnConfirmCallback(null);
    }, 300);
  }, []);

  const confirm = useCallback(async () => {
    if (!onConfirmCallback) return;

    try {
      setIsLoading(true);
      await onConfirmCallback();
      close();
    } catch {
      // Error handling is done by the callback (useContractMutation)
      setIsLoading(false);
      // Keep modal open on error so user can retry or cancel
    }
  }, [onConfirmCallback, close]);

  return {
    isOpen,
    data,
    isLoading,
    show,
    close,
    confirm,
  };
}
