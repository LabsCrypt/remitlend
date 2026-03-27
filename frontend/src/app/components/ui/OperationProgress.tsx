"use client";

import { AlertCircle, CheckCircle2, Loader, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { OptimisticUIStore } from "../../hooks/useOptimisticUI";
import clsx from "clsx";

interface OperationProgressProps {
  transaction?: ReturnType<OptimisticUIStore["getTransaction"]>;
  type?: "deposit" | "withdrawal" | "repayment" | "generic";
}

export function OperationProgress({ transaction, type = "generic" }: OperationProgressProps) {
  if (!transaction) return null;

  const { status, message, progress, error, txHash } = transaction;

  const getIcon = () => {
    switch (status) {
      case "pending":
        return <Loader className="h-5 w-5 animate-spin text-blue-500" />;
      case "success":
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case "error":
        return <AlertCircle className="h-5 w-5 text-red-500" />;
      default:
        return null;
    }
  };

  const getTypeIcon = () => {
    switch (type) {
      case "deposit":
        return <ArrowUpRight className="h-4 w-4" />;
      case "withdrawal":
        return <ArrowDownLeft className="h-4 w-4" />;
      default:
        return null;
    }
  };

  return (
    <div
      className={clsx(
        "rounded-lg border p-4 space-y-2",
        status === "pending" &&
          "border-blue-200 bg-blue-50 dark:border-blue-900/30 dark:bg-blue-950/20",
        status === "success" &&
          "border-green-200 bg-green-50 dark:border-green-900/30 dark:bg-green-950/20",
        status === "error" && "border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/20",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {getIcon()}
          <div className="flex items-center gap-1">
            {getTypeIcon()}
            <span
              className={clsx(
                "font-medium text-sm",
                status === "pending" && "text-blue-900 dark:text-blue-200",
                status === "success" && "text-green-900 dark:text-green-200",
                status === "error" && "text-red-900 dark:text-red-200",
              )}
            >
              {message}
            </span>
          </div>
        </div>

        {txHash && (
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:underline"
          >
            View TX
          </a>
        )}
      </div>

      {status === "pending" && progress !== undefined && progress > 0 && (
        <div className="overflow-hidden rounded-full bg-gray-200 h-1.5 dark:bg-gray-700">
          <div
            className="bg-blue-500 h-full transition-all duration-300 ease-out"
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
