"use client";

import {
  AlertCircle,
  CheckCircle2,
  Loader,
  ArrowUpRight,
  ArrowDownLeft,
  Loader2,
  Send,
  Clock,
} from "lucide-react";
import { OptimisticUIStore, type TransactionStatus } from "../../hooks/useOptimisticUI";
import clsx from "clsx";

interface OperationProgressProps {
  transaction?: ReturnType<OptimisticUIStore["getTransaction"]>;
  type?: "deposit" | "withdrawal" | "repayment" | "generic";
}

const statusColors: Record<TransactionStatus, { border: string; bg: string; text: string }> = {
  idle: { border: "border-zinc-200", bg: "bg-zinc-50", text: "text-zinc-900" },
  pending: { border: "border-zinc-200", bg: "bg-zinc-50", text: "text-zinc-900" },
  signing: { border: "border-amber-200", bg: "bg-amber-50", text: "text-amber-900" },
  submitted: { border: "border-blue-200", bg: "bg-blue-50", text: "text-blue-900" },
  confirming: { border: "border-indigo-200", bg: "bg-indigo-50", text: "text-indigo-900" },
  confirmed: { border: "border-green-200", bg: "bg-green-50", text: "text-green-900" },
  failed: { border: "border-red-200", bg: "bg-red-50", text: "text-red-900" },
};

const statusIcons: Record<TransactionStatus, React.ReactNode> = {
  idle: null,
  pending: null,
  signing: <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin text-amber-500" />,
  submitted: <Send aria-hidden="true" className="h-5 w-5 text-blue-500" />,
  confirming: <Loader aria-hidden="true" className="h-5 w-5 animate-spin text-indigo-500" />,
  confirmed: <CheckCircle2 aria-hidden="true" className="h-5 w-5 text-green-500" />,
  failed: <AlertCircle aria-hidden="true" className="h-5 w-5 text-red-500" />,
};

export function OperationProgress({ transaction, type = "generic" }: OperationProgressProps) {
  if (!transaction) return null;

  const { status, message, progress, error, txHash } = transaction;
  const colors = statusColors[status] || statusColors.idle;

  const getTypeIcon = () => {
    switch (type) {
      case "deposit":
        return <ArrowUpRight aria-hidden="true" className="h-4 w-4" />;
      case "withdrawal":
        return <ArrowDownLeft aria-hidden="true" className="h-4 w-4" />;
      default:
        return null;
    }
  };

  // Only show progress bar for non-terminal states
  const showProgress = status !== "confirmed" && status !== "failed" && status !== "idle";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={clsx(
        "rounded-lg border p-4 space-y-2",
        colors.border,
        colors.bg,
        "dark:border-zinc-700 dark:bg-zinc-900/50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {statusIcons[status]}
          <div className="flex items-center gap-1">
            {getTypeIcon()}
            <span className={clsx("font-medium text-sm", colors.text, "dark:text-zinc-200")}>
              {message}
            </span>
          </div>
        </div>

        {/* Show explorer link for submitted, confirming, and confirmed states */}
        {txHash &&
          (status === "submitted" || status === "confirming" || status === "confirmed") && (
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View transaction ${txHash.slice(0, 8)}… on Stellar Explorer (opens in new tab)`}
              className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline flex items-center gap-1"
            >
              <Clock className="h-3 w-3" />
              View TX
            </a>
          )}
      </div>

      {showProgress && progress !== undefined && progress > 0 && (
        <div
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Operation progress: ${Math.round(progress)}%`}
          className="overflow-hidden rounded-full bg-gray-200 h-1.5 dark:bg-gray-700"
        >
          <div
            className={clsx(
              "h-full transition-all duration-300 ease-out",
              status === "signing" && "bg-amber-500",
              status === "submitted" && "bg-blue-500",
              status === "confirming" && "bg-indigo-500",
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {error && <p className="text-xs text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}

interface OperationProgressListProps {
  transactions: Record<string, ReturnType<OptimisticUIStore["getTransaction"]> | undefined>;
}

export function OperationProgressList({ transactions }: OperationProgressListProps) {
  const activeTransactions = Object.entries(transactions)
    .filter(([_, tx]) => tx && tx.status !== "idle")
    .sort(([_, a], [__, b]) => (b?.startTime ?? 0) - (a?.startTime ?? 0));

  if (activeTransactions.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 space-y-2 max-w-sm z-50">
      {activeTransactions.map(([id, tx]) => (
        <OperationProgress key={id} transaction={tx} />
      ))}
    </div>
  );
}
