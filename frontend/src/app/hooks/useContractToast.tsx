/**
 * hooks/useContractToast.ts
 *
 * Custom hook for displaying toast notifications during blockchain transaction lifecycle.
 * Provides automatic feedback for pending/success/failed states with Stellar explorer links.
 */

import { useToastStore } from "../stores/useToastStore";

interface ToastOptions {
  /** Transaction hash from Stellar */
  txHash?: string;
  /** Custom success message */
  successMessage?: string;
  /** Custom error message */
  errorMessage?: string;
  /** Stellar network (testnet or public) */
  network?: "testnet" | "public";
  /** Optional retry action shown on error toasts */
  retryAction?: () => void;
}

/**
 * Hook for managing transaction toast notifications.
 * Automatically shows pending state and updates to success/failure.
 */
export function useContractToast() {
  const addToast = useToastStore((state) => state.addToast);
  const updateToast = useToastStore((state) => state.updateToast);

  const getStellarExpertUrl = (txHash: string, network: "testnet" | "public" = "testnet") => {
    const baseUrl =
      network === "testnet"
        ? "https://stellar.expert/explorer/testnet"
        : "https://stellar.expert/explorer/public";
    return `${baseUrl}/tx/${txHash}`;
  };

  /**
   * Show a pending transaction toast.
   * Returns the toast ID for later updates.
   */
  const showPending = (message: string = "Transaction pending..."): string | number => {
    return addToast({
      type: "info",
      title: message,
      description: "Waiting for blockchain confirmation",
    });
  };

  /**
   * Update a pending toast to success state.
   * Includes a link to Stellar Expert for transaction details.
   */
  const showSuccess = (toastId: string | number, options: ToastOptions = {}): string | number => {
    const { txHash, successMessage = "Transaction successful!", network = "testnet" } = options;
    const explorerUrl = txHash ? getStellarExpertUrl(txHash, network) : undefined;

    updateToast(String(toastId), {
      type: "success",
      title: successMessage,
      description: "Your transaction has been confirmed on the blockchain",
      txHash,
      explorerUrl,
      duration: 6000,
    });

    return toastId;
  };

  /**
   * Update a pending toast to error state.
   */
  const showError = (toastId: string | number, options: ToastOptions = {}): string | number => {
    const { errorMessage = "Transaction failed", retryAction } = options;

    updateToast(String(toastId), {
      type: "error",
      title: errorMessage,
      description: "Please try again or contact support if the issue persists",
      duration: 10000,
      action: retryAction
        ? {
            label: "Retry",
            onClick: retryAction,
          }
        : undefined,
    });

    return toastId;
  };

  /**
   * Standalone success toast (without pending state).
   */
  const success = (message: string, options: ToastOptions = {}): string | number => {
    const { txHash, network = "testnet" } = options;
    const explorerUrl = txHash ? getStellarExpertUrl(txHash, network) : undefined;

    return addToast({
      type: "success",
      title: message,
      description: "Your transaction has been confirmed on the blockchain",
      txHash,
      explorerUrl,
      duration: 5000,
    });
  };

  /**
   * Standalone error toast.
   */
  const error = (message: string, description?: string): string | number => {
    return addToast({
      type: "error",
      title: message,
      description: description ?? "Please try again or contact support if the issue persists",
      duration: 10000,
    });
  };

  /**
   * Info toast for general notifications.
   */
  const info = (message: string, description?: string): string | number => {
    return addToast({
      type: "info",
      title: message,
      description,
      duration: 4000,
    });
  };

  /**
   * Warning toast for cautionary messages.
   */
  const warning = (message: string, description?: string): string | number => {
    return addToast({
      type: "warning",
      title: message,
      description,
      duration: 5000,
    });
  };

  return {
    showPending,
    showSuccess,
    showError,
    success,
    error,
    info,
    warning,
    getStellarExpertUrl,
  };
}
