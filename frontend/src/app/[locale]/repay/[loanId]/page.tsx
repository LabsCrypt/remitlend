"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { Button } from "../../../components/ui/Button";
import {
  TransactionStatusTracker,
  type TransactionStatusState,
} from "../../../components/ui/TransactionStatusTracker";
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

  const [amount, setAmount] = useState("250");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [trackerState, setTrackerState] = useState<TransactionStatusState>("idle");
  const [trackerTitle, setTrackerTitle] = useState("Ready to repay");
  const [trackerMessage, setTrackerMessage] = useState("");
  const [trackerGuidance, setTrackerGuidance] = useState<string | undefined>(undefined);
  const [trackerTxHash, setTrackerTxHash] = useState<string | null>(null);
  const [lastError, setLastError] = useState<TransactionErrorDetails | null>(null);

  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const amountNumber = useMemo(() => Number(amount || "0"), [amount]);

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
      setTrackerState("signing");
      setTrackerTitle("Awaiting wallet confirmation");
      setTrackerMessage("Approve the repayment transaction in your wallet.");

      await new Promise((resolve) => setTimeout(resolve, 600));

      setTrackerState("submitting");
      setTrackerTitle("Submitting repayment");
      setTrackerMessage("Sending repayment transaction to the network.");
      toastId = toast.showPending("Repayment transaction submitted");

      await new Promise((resolve) => setTimeout(resolve, 700));

      const txHash = createDemoTxHash();
      setTrackerTxHash(txHash);
      setTrackerState("polling");
      setTrackerTitle("Tracking confirmation");
      setTrackerMessage("Polling transaction status on-chain. This can take a few seconds.");

      await new Promise<void>((resolve) => {
        pendingTimeoutRef.current = setTimeout(() => {
          pendingTimeoutRef.current = null;
          resolve();
        }, 2200);
      });

      setTrackerState("success");
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
      setTrackerState(mapped.cancelledByUser ? "cancelled" : "error");
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
    await runRepayment();
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
          Continue to confirmation
        </Button>
      </form>

      <TransactionStatusTracker
        state={trackerState}
        title={trackerTitle}
        message={trackerMessage}
        guidance={trackerGuidance}
        txHash={trackerTxHash}
        onCancel={
          trackerState === "signing" || trackerState === "submitting" || trackerState === "polling"
            ? cancelFlow
            : undefined
        }
        onRetry={
          trackerState === "error" || trackerState === "cancelled"
            ? lastError?.retryable === false
              ? undefined
              : handleRetry
            : undefined
        }
        disabled={isSubmitting}
      />
    </section>
  );
}
