/**
 * hooks/useContractToast.ts
 *
 * Custom hook for displaying toast notifications during blockchain transaction lifecycle.
 * Provides automatic feedback for Pending / Success / Failed states with Stellar Expert links.
 */

import { toast } from "sonner";
import { ExternalLink } from "lucide-react";

export type TransactionStatus = "pending" | "success" | "failed";

interface ToastOptions {
  /** Transaction hash from Stellar */
  txHash?: string;
  /** Custom success message */
  successMessage?: string;
  /** Custom error message */
  errorMessage?: string;
  /** Stellar network (testnet or public) */
  network?: "testnet" | "public";
}

/**
 * Hook for managing transaction toast notifications.
 * Automatically shows pending state and updates to success/failure.
 */
export function useContractToast() {
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
    return toast.loading(message, {
      description: "Waiting for blockchain confirmation",
    });
  };

  /**
   * Update a pending toast to success state.
   * Includes a link to Stellar Expert for transaction details.
   */
  const showSuccess = (toastId: string | number, options: ToastOptions = {}): string | number => {
    const { txHash, successMessage = "Transaction successful!", network = "testnet" } = options;

    if (txHash) {
      const expertUrl = getStellarExpertUrl(txHash, network);
      return toast.success(successMessage, {
        id: toastId,
        description: "Your transaction has been confirmed on the blockchain",
        action: {
          label: (
            <span className="flex items-center gap-1">
              View on Explorer <ExternalLink size={14} />
            </span>
          ),
          onClick: () => window.open(expertUrl, "_blank", "noopener,noreferrer"),
        },
        duration: 6000,
      });
    }

    return toast.success(successMessage, {
      id: toastId,
      description: "Your transaction has been confirmed",
      duration: 5000,
    });
  };

  /**
   * Update a pending toast to error state.
   */
  const showError = (toastId: string | number, options: ToastOptions = {}): string | number => {
    const { errorMessage = "Transaction failed" } = options;

    return toast.error(errorMessage, {
      id: toastId,
      description: "Please try again or contact support if the issue persists",
      duration: 6000,
    });
  };

  /**
   * Standalone success toast (without pending state).
   */
  const success = (message: string, options: ToastOptions = {}): string | number => {
    const { txHash, network = "testnet" } = options;

    if (txHash) {
      const expertUrl = getStellarExpertUrl(txHash, network);
      return toast.success(message, {
        description: "Your transaction has been confirmed on the blockchain",
        action: {
          label: (
            <span className="flex items-center gap-1">
              View on Explorer <ExternalLink size={14} />
            </span>
          ),
          onClick: () => window.open(expertUrl, "_blank", "noopener,noreferrer"),
        },
        duration: 6000,
      });
    }

    return toast.success(message, {
      duration: 5000,
    });
  };

  /**
   * Standalone error toast.
   */
  const error = (message: string, description?: string): string | number => {
    return toast.error(message, {
      description: description ?? "Please try again or contact support if the issue persists",
      duration: 6000,
    });
  };

  /**
   * Info toast for general notifications.
   */
  const info = (message: string, description?: string): string | number => {
    return toast.info(message, {
      description,
      duration: 4000,
    });
  };

  /**
   * Warning toast for cautionary messages.
   */
  const warning = (message: string, description?: string): string | number => {
    return toast.warning(message, {
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
