"use client";

import { useEffect, useMemo } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "./Button";

export type TransactionConfirmType = "Loan Request" | "Repayment" | "Deposit" | "Withdraw";

export interface TransactionConfirmData {
  type: TransactionConfirmType;
  amount: string;
  feeEstimate: string;
  gasEstimate: string;
  network: string;
  details?: Array<{ label: string; value: string }>;
}

interface TransactionConfirmModalProps {
  isOpen: boolean;
  data: TransactionConfirmData;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function getNetworkBadge(network: string): { label: string; classes: string } {
  const normalized = network.toLowerCase();
  if (normalized.includes("mainnet")) {
    return {
      label: "MAINNET",
      classes:
        "bg-green-100 text-green-900 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900/40",
    };
  }

  return {
    label: "TESTNET",
    classes:
      "bg-yellow-100 text-yellow-900 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-300 dark:border-yellow-900/40",
  };
}

export function TransactionConfirmModal({
  isOpen,
  data,
  isLoading = false,
  onConfirm,
  onCancel,
}: TransactionConfirmModalProps) {
  const networkBadge = useMemo(() => getNetworkBadge(data.network), [data.network]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isLoading) {
        event.preventDefault();
        onCancel();
      }

      if (event.key === "Enter" && !isLoading) {
        event.preventDefault();
        onConfirm();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isLoading, onCancel, onConfirm]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />

      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="tx-confirm-title"
        className="relative z-10 w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2
              id="tx-confirm-title"
              className="text-xl font-semibold text-zinc-900 dark:text-zinc-100"
            >
              Confirm Transaction
            </h2>
            <span
              className={`rounded-full border px-3 py-1 text-xs font-semibold tracking-[0.15em] ${networkBadge.classes}`}
            >
              {networkBadge.label}
            </span>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Transaction Type</p>
            <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{data.type}</p>
          </div>
        </header>

        <div className="mt-5 space-y-4">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800">
            <div className="grid grid-cols-1 divide-y divide-zinc-200 dark:divide-zinc-800">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-zinc-500 dark:text-zinc-400">Amount</span>
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {data.amount}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-zinc-500 dark:text-zinc-400">Fee Estimate</span>
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {data.feeEstimate}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-zinc-500 dark:text-zinc-400">Estimated Gas Cost</span>
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {data.gasEstimate}
                </span>
              </div>
            </div>
          </div>

          {data.details && data.details.length > 0 && (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Transaction Details
              </h3>
              <div className="mt-3 space-y-2">
                {data.details.map((detail) => (
                  <div
                    key={detail.label}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-zinc-500 dark:text-zinc-400">{detail.label}</span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {detail.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-950/20">
            <div className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Verify all values before signing. This modal cannot be dismissed by clicking
                outside. Press Escape to cancel or Enter to confirm.
              </p>
            </div>
          </div>
        </div>

        <footer className="mt-6 flex gap-3">
          <Button variant="outline" className="w-full" onClick={onCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button className="w-full" onClick={onConfirm} disabled={isLoading}>
            {isLoading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Simulating...
              </span>
            ) : (
              "Confirm"
            )}
          </Button>
        </footer>
      </section>
    </div>
  );
}
