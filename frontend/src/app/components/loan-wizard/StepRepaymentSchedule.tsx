"use client";

import { CalendarDays, TrendingDown } from "lucide-react";
import { Button } from "../ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import type { LoanWizardData } from "./LoanApplicationWizard";

const ANNUAL_RATE = 0.12;

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
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
  totalPayment: number;
  balance: number;
}

function buildRepaymentSchedule(principal: number, termDays: number): RepaymentRow[] {
  const totalInterest = (principal * ANNUAL_RATE * termDays) / 365;
  const today = new Date();

  // Single-payment schedule (balloon): one row for the full loan
  return [
    {
      period: 1,
      dueDate: formatDate(addDays(today, termDays)),
      principal,
      interest: totalInterest,
      totalPayment: principal + totalInterest,
      balance: 0,
    },
  ];
}

interface StepRepaymentScheduleProps {
  data: LoanWizardData;
  onNext: () => void;
  onBack: () => void;
}

export function StepRepaymentSchedule({ data, onNext, onBack }: StepRepaymentScheduleProps) {
  const principal = Number(data.amount || "0");
  const totalInterest = (principal * ANNUAL_RATE * data.termDays) / 365;
  const totalRepayment = principal + totalInterest;
  const schedule = buildRepaymentSchedule(principal, data.termDays);
  const today = new Date();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarDays className="h-5 w-5 text-indigo-500" />
            Repayment Schedule
          </CardTitle>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Review your payment obligations before confirming.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Principal</p>
              <p className="mt-0.5 font-semibold text-zinc-900 dark:text-zinc-50">
                {formatMoney(principal)}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Total Interest</p>
              <p className="mt-0.5 font-semibold text-zinc-900 dark:text-zinc-50">
                {formatMoney(totalInterest)}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">APR</p>
              <p className="mt-0.5 font-semibold text-zinc-900 dark:text-zinc-50">12%</p>
            </div>
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-900/50 dark:bg-indigo-950/30">
              <p className="text-xs text-indigo-600 dark:text-indigo-400">Total Due</p>
              <p className="mt-0.5 font-semibold text-indigo-700 dark:text-indigo-300">
                {formatMoney(totalRepayment)}
              </p>
            </div>
          </div>

          {/* Timeline */}
          <div className="flex items-center gap-3 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
            <TrendingDown className="h-5 w-5 shrink-0 text-zinc-400" />
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              Loan start:{" "}
              <span className="font-medium text-zinc-900 dark:text-zinc-50">
                {formatDate(today)}
              </span>{" "}
              → Due date:{" "}
              <span className="font-medium text-zinc-900 dark:text-zinc-50">
                {formatDate(addDays(today, data.termDays))}
              </span>{" "}
              ({data.termDays} days)
            </div>
          </div>

          {/* Schedule table */}
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                  <th className="px-4 py-3 text-left font-medium text-zinc-600 dark:text-zinc-400">
                    #
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
                    Total Payment
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-zinc-600 dark:text-zinc-400">
                    Remaining
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
                      {formatMoney(row.totalPayment)}
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
                    Total
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-indigo-600 dark:text-indigo-400">
                    {formatMoney(totalRepayment)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-xs text-zinc-400 dark:text-zinc-500">
            This is a balloon-payment loan: the full principal plus accrued interest is due on the
            due date. Interest is calculated at a fixed 12% APR using simple interest.
          </p>

          <div className="flex gap-3">
            <Button variant="outline" onClick={onBack} className="w-full">
              Back
            </Button>
            <Button onClick={onNext} className="w-full">
              Continue to Collateral
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
