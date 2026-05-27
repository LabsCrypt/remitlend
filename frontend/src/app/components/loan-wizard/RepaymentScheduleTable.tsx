"use client";

import { CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import type { LoanAmortization, LoanAmortizationScheduleRow } from "../../hooks/useApi";
import { EmptyState } from "../ui/EmptyState";

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface RepaymentRow {
  period: number;
  dueDate: string;
  principal: number;
  interest: number;
  total: number;
  balance: number;
}

function mapScheduleRows(rows: LoanAmortizationScheduleRow[]): RepaymentRow[] {
  return rows.map((row, index) => ({
    period: index + 1,
    dueDate: formatDate(new Date(row.date)),
    principal: row.principalPortion,
    interest: row.interestPortion,
    total: row.totalDue,
    balance: row.runningBalance,
  }));
}

interface RepaymentScheduleTableProps {
  amortization: LoanAmortization;
  title?: string;
  description?: string;
  compact?: boolean;
  showSummaryCards?: boolean;
}

export function RepaymentScheduleTable({
  amortization,
  title = "Repayment Schedule",
  description = "Review how each payment is split across the life of the loan.",
  compact = false,
  showSummaryCards = true,
}: RepaymentScheduleTableProps) {
  const schedule = mapScheduleRows(amortization.schedule);

  return (
    <Card>
      <CardHeader className={compact ? "pb-4" : undefined}>
        <CardTitle className="flex items-center gap-2 text-lg">
          <CalendarDays className="h-5 w-5 text-indigo-500" />
          {title}
        </CardTitle>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
      </CardHeader>
      <CardContent className={compact ? "space-y-4" : "space-y-6"}>
        {showSummaryCards && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Principal Total</p>
              <p className="mt-0.5 font-semibold text-zinc-900 dark:text-zinc-50">
                {formatMoney(amortization.principal)}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Total Interest</p>
              <p className="mt-0.5 font-semibold text-zinc-900 dark:text-zinc-50">
                {formatMoney(amortization.totalInterest)}
              </p>
            </div>
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-900/50 dark:bg-indigo-950/30">
              <p className="text-xs text-indigo-600 dark:text-indigo-400">Total Cost of Loan</p>
              <p className="mt-0.5 font-semibold text-indigo-700 dark:text-indigo-300">
                {formatMoney(amortization.totalDue)}
              </p>
            </div>
          </div>
        )}

        {schedule.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="No repayment schedule available"
            description="Generate or load a loan preview to see installment dates and balances."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  <th className="px-4 py-3 text-left font-medium text-zinc-600 dark:text-zinc-400">
                    Period
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-600 dark:text-zinc-400">
                    Due Date
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-400">
                    Principal
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-400">
                    Interest
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-400">
                    Total
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-400">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((row) => (
                  <tr key={row.period} className="border-b border-zinc-100 dark:border-zinc-800/50">
                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{row.period}</td>
                    <td className="px-4 py-3 text-zinc-900 dark:text-zinc-50">{row.dueDate}</td>
                    <td className="px-4 py-3 text-right text-zinc-900 dark:text-zinc-50">
                      {formatMoney(row.principal)}
                    </td>
                    <td className="px-4 py-3 text-right text-amber-600 dark:text-amber-400">
                      {formatMoney(row.interest)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-zinc-900 dark:text-zinc-50">
                      {formatMoney(row.total)}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-500 dark:text-zinc-400">
                      {formatMoney(row.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-zinc-50 dark:bg-zinc-900">
                  <td
                    colSpan={4}
                    className="px-4 py-3 text-right font-semibold text-zinc-700 dark:text-zinc-300"
                  >
                    Total Cost of Loan
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-indigo-600 dark:text-indigo-400">
                    {formatMoney(amortization.totalDue)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
