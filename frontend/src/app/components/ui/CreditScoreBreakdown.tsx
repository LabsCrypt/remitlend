"use client";

import { Loader2, AlertCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "./Card";
import { formatCurrency } from "../borrower/loanFormatters";

interface CreditScoreBreakdownProps {
  score?: number | null;
  breakdown?: {
    totalLoans: number;
    repaidOnTime: number;
    repaidLate: number;
    defaulted: number;
    totalRepaid: number;
    averageRepaymentTime: string;
    longestStreak: number;
    currentStreak: number;
  };
  isLoading?: boolean;
  error?: Error | null;
}

export function CreditScoreBreakdown({
  score,
  breakdown,
  isLoading = false,
  error = null,
}: CreditScoreBreakdownProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Score Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading score breakdown...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Score Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="h-4 w-4" /> Unable to load score breakdown.
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!score || !breakdown) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Score Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Connect your wallet and build a credit history to view a detailed breakdown.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Score Breakdown</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Total loans
            </p>
            <p className="mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {breakdown.totalLoans}
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              On-time repayments
            </p>
            <p className="mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {breakdown.repaidOnTime}
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Late repayments
            </p>
            <p className="mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {breakdown.repaidLate}
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Defaults
            </p>
            <p className="mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {breakdown.defaulted}
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Total repaid
            </p>
            <p className="mt-2 text-lg font-bold text-zinc-900 dark:text-zinc-50">
              {formatCurrency(breakdown.totalRepaid)}
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Avg repayment time
            </p>
            <p className="mt-2 text-lg font-bold text-zinc-900 dark:text-zinc-50">
              {breakdown.averageRepaymentTime}
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Current streak
            </p>
            <p className="mt-2 text-lg font-bold text-zinc-900 dark:text-zinc-50">
              {breakdown.currentStreak} payments
            </p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Longest streak
            </p>
            <p className="mt-2 text-lg font-bold text-zinc-900 dark:text-zinc-50">
              {breakdown.longestStreak} payments
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
