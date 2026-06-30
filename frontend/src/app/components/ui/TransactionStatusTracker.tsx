"use client";

import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "./Button";

export type TransactionStatusState =
  | "idle"
  | "signing"
  | "submitting"
  | "polling"
  | "success"
  | "error"
  | "cancelled";

interface TransactionStatusTrackerProps {
  state: TransactionStatusState;
  title: string;
  message: string;
  txHash?: string | null;
  guidance?: string;
  retryLabel?: string;
  onRetry?: () => void;
  onCancel?: () => void;
  disabled?: boolean;
}

function getProgress(state: TransactionStatusState): number {
  switch (state) {
    case "signing":
      return 25;
    case "submitting":
      return 55;
    case "polling":
      return 85;
    case "success":
      return 100;
    default:
      return 0;
  }
}

export function TransactionStatusTracker({
  state,
  title,
  message,
  txHash,
  guidance,
  retryLabel = "Retry",
  onRetry,
  onCancel,
  disabled,
}: TransactionStatusTrackerProps) {
  if (state === "idle") {
    return null;
  }

  const isPending = state === "signing" || state === "submitting" || state === "polling";
  const isError = state === "error";
  const isSuccess = state === "success";
  const isCancelled = state === "cancelled";
  const progress = getProgress(state);

  return (
    <section
      aria-live="polite"
      className={[
        "rounded-xl border p-4",
        isPending && "border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-950/20",
        isSuccess &&
          "border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/20",
        isError && "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20",
        isCancelled && "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-start gap-3">
        {isPending && (
          <div role="status">
            <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-blue-600" />
            <span className="sr-only">Loading...</span>
          </div>
        )}
        {isSuccess && <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />}
        {isError && <XCircle className="mt-0.5 h-5 w-5 text-red-600" />}
        {isCancelled && <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />}

        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{message}</p>
          </div>

          {isPending && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          {txHash && (
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-xs text-indigo-600 underline underline-offset-2"
            >
              View on-chain transaction
            </a>
          )}

          {guidance && <p className="text-xs text-zinc-600 dark:text-zinc-400">{guidance}</p>}

          <div className="flex flex-wrap gap-2 pt-1">
            {isPending && onCancel && (
              <Button variant="outline" size="sm" onClick={onCancel} disabled={disabled}>
                Cancel
              </Button>
            )}

            {(isError || isCancelled) && onRetry && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onRetry}
                disabled={disabled}
                leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              >
                {retryLabel}
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
