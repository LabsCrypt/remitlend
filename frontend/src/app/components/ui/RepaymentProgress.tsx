"use client";

import { LoanStatusBadge } from "./LoanStatusBadge";

interface RepaymentProgressProps {
  totalRepaid: number;
  totalOwed: number;
  status: "active" | "repaid" | "defaulted" | "pending";
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function RepaymentProgress({ totalRepaid, totalOwed, status }: RepaymentProgressProps) {
  const total = totalRepaid + totalOwed;
  const progress = total > 0 ? Math.min((totalRepaid / total) * 100, 100) : 100;

  return (
    <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Repayment progress</p>
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {progress.toFixed(1)}%
        </p>
      </div>

      <div className="h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className="h-2 rounded-full bg-indigo-600 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        <span>
          Paid:{" "}
          <strong className="text-zinc-900 dark:text-zinc-50">{formatCurrency(totalRepaid)}</strong>
        </span>
        <span>
          Remaining:{" "}
          <strong className="text-zinc-900 dark:text-zinc-50">{formatCurrency(totalOwed)}</strong>
        </span>
        <LoanStatusBadge status={status} />
      </div>
    </div>
  );
}
