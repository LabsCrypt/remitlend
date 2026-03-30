"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { Button } from "../../../components/ui/Button";
import {
  TransactionStatusTracker,
  type TransactionStatusState,
} from "../../../components/ui/TransactionStatusTracker";
import { TransactionPreviewModal } from "../../../components/transaction/TransactionPreviewModal";
import { useTransactionPreview } from "../../../hooks/useTransactionPreview";
import { formatLoanRepayment } from "../../../utils/transactionFormatter";
import {
  mapTransactionError,
  type TransactionErrorDetails,
} from "../../../utils/transactionErrors";
import {
  selectIsWalletConnected,
  selectWalletAddress,
  useWalletStore,
} from "../../../stores/useWalletStore";
import { useContractToast } from "../../../hooks/useContractToast";

const DEMO_AVAILABLE_BALANCE = 1_000;

function createDemoTxHash(): string {
  const random = Math.random().toString(16).slice(2);
  return `${Date.now().toString(16)}${random}`.padEnd(64, "0").slice(0, 64);
}

export default function RepayLoanPage() {
  const params = useParams<{ loanId: string }>();
  const loanId = params?.loanId ?? "unknown";

  const walletAddress = useWalletStore(selectWalletAddress);
  const isWalletConnected = useWalletStore(selectIsWalletConnected);
  const toast = useContractToast();
  const txPreview = useTransactionPreview();

  const [amount, setAmount] = useState("250");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [trackerState, setTrackerState] = useState<TransactionStatusState>("idle");
  const [trackerTitle, setTrackerTitle] = useState("Ready to repay");
  const [trackerMessage, setTrackerMessage] = useState("");
  const [trackerGuidance, setTrackerGuidance] = useState<string | undefined>(undefined);
  const [trackerTxHash, setTrackerTxHash] = useState<string | null>(null);
  const [lastError, setLastError] = useState<TransactionErrorDetails | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [showRecoveryLink, setShowRecoveryLink] = useState(false);

  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const amountNumber = useMemo(() => Number(amount || "0"), [amount]);

  const getEstimatedWaitTime = () => {
    if (trackerState !== "confirming" || !startTime) return undefined;
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, 5000 - elapsed); // Assume 5 second total wait
    if (remaining === 0) return "Should be confirmed soon";
    return `${Math.ceil(remaining / 1000)}s remaining`;
  };

  const handleRecovery = () => {
    // In a real app, this would trigger recovery logic
    toast.info("Recovery initiated", "Attempting to recover stuck transaction...");
    setTimeout(() => {
      setTrackerState("confirmed");
      setTrackerTitle("Recovery successful");
      setTrackerMessage("Transaction recovered and confirmed.");
    }, 2000);
  };

  const clearPendingTimeout = () => {
    if (pendingTimeoutRef.current) {
      clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }
  };

  const cancelFlow = () => {
    clearPendingTimeout();
    setTrackerState("cancelled");
    setTrackerTitle("Repayment cancelled");
    setTrackerMessage("You cancelled the repayment flow.");
    setTrackerGuidance("No payment was submitted. Update the amount and try again.");
    setIsSubmitting(false);
  };

  const runRepayment = async () => {
    clearPendingTimeout();
    setLastError(null);
    setTrackerTxHash(null);
    setStartTime(Date.now());
    setShowRecoveryLink(false);

    let toastId: string | number | null = null;

    try {
      if (!isWalletConnected || !walletAddress) {
        throw new Error("Wallet not connected");
      }

      if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
        throw new Error("Invalid repayment amount");
      }

      if (amountNumber > DEMO_AVAILABLE_BALANCE) {
        throw new Error("Insufficient balance for repayment");
      }

      setIsSubmitting(true);
      setTrackerState("pending");
      setTrackerTitle("Preparing repayment");
      setTrackerMessage("Validating transaction details...");

      await new Promise((resolve) => setTimeout(resolve, 600));

      setTrackerState("submitted");
      setTrackerTitle("Transaction submitted");
      setTrackerMessage("Repayment transaction sent to network.");
      toastId = toast.showPending("Repayment transaction submitted");

      await new Promise((resolve) => setTimeout(resolve, 700));

      const txHash = createDemoTxHash();
      setTrackerTxHash(txHash);

      setTrackerState("confirming");
      setTrackerTitle("Confirming on-chain");
      setTrackerMessage("Waiting for ledger close. This typically takes 3-5 seconds.");

      // Show recovery link after 60 seconds
      setTimeout(() => {
        if (trackerState === "confirming") {
          setShowRecoveryLink(true);
        }
      }, 60000);

      await new Promise<void>((resolve) => {
        pendingTimeoutRef.current = setTimeout(() => {
          pendingTimeoutRef.current = null;
          resolve();
        }, 2200);
      });

      setTrackerState("confirmed");
      setTrackerTitle("Repayment recorded");
      setTrackerMessage("Your repayment was submitted and confirmed.");
      setTrackerGuidance("You can return to the loan page to verify updated outstanding balance.");

      if (toastId !== null) {
        toast.showSuccess(toastId, {
          successMessage: "Repayment confirmed",
          txHash,
        });
      }
    } catch (error) {
      const mapped = mapTransactionError(error);
      setLastError(mapped);
      setTrackerState("failed");
      setTrackerTitle(mapped.title);
      setTrackerMessage(mapped.message);
      setTrackerGuidance(mapped.guidance);

      if (toastId !== null) {
        toast.showError(toastId, {
          errorMessage: mapped.title,
          retryAction: mapped.retryable ? handleRetry : undefined,
        });
      } else {
        toast.error(mapped.title, mapped.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    
    const previewData = formatLoanRepayment({
      loanId: parseInt(loanId),
      amount: amountNumber,
    });

    txPreview.show(previewData, async () => {
      await runRepayment();
    });
  };

  const handleRetry = async () => {
    await runRepayment();
  };

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
          Borrower Portal
        </p>
        <h1 className="mt-3 text-3xl font-bold text-zinc-900 dark:text-zinc-50">
          Repay Loan #{loanId}
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          This repayment flow includes structured error recovery, clear guidance, and transaction
          status tracking.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none"
      >
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          Demo available balance: ${DEMO_AVAILABLE_BALANCE.toLocaleString()}
        </div>

        <div>
          <label
            htmlFor="repayment-amount"
            className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
          >
            Repayment amount
          </label>
          <input
            id="repayment-amount"
            type="number"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-zinc-900 outline-none transition focus:border-indigo-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        <Button type="submit" className="w-full" isLoading={isSubmitting}>
          Review Repayment
        </Button>
      </form>

      <TransactionStatusTracker
        state={trackerState}
        title={trackerTitle}
        message={trackerMessage}
        guidance={trackerGuidance}
        txHash={trackerTxHash}
        onCancel={
          trackerState === "pending" || trackerState === "submitted" || trackerState === "confirming"
            ? cancelFlow
            : undefined
        }
        onRetry={
          trackerState === "failed" || trackerState === "cancelled"
            ? lastError?.retryable === false
              ? undefined
              : handleRetry
            : undefined
        }
        disabled={isSubmitting}
        estimatedWaitTime={getEstimatedWaitTime()}
        showRecoveryLink={showRecoveryLink}
        onRecovery={handleRecovery}
      />

      {txPreview.data && (
        <TransactionPreviewModal
          isOpen={txPreview.isOpen}
          onClose={txPreview.close}
          onConfirm={txPreview.confirm}
          data={txPreview.data}
          isLoading={txPreview.isLoading || isSubmitting}
        />
      )}
    </section>
  );
}
