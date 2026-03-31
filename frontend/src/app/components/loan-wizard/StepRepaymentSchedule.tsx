"use client";

import { AlertCircle, CalendarDays, Loader2 } from "lucide-react";
import { Button } from "../ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import { useLoanAmortizationPreview, useLoanAmortizationSchedule } from "../../hooks/useApi";
import { RepaymentScheduleTable } from "./RepaymentScheduleTable";
import type { LoanWizardData } from "./LoanApplicationWizard";

interface StepRepaymentScheduleProps {
  data: LoanWizardData;
  loanId?: string;
  onNext: () => void;
  onBack: () => void;
}

export function StepRepaymentSchedule({
  data,
  loanId,
  onNext,
  onBack,
}: StepRepaymentScheduleProps) {
  const amortizationQuery = useLoanAmortizationSchedule(loanId, {
    retry: false,
  });
  const amount = Number(data.amount);
  const previewQuery = useLoanAmortizationPreview(
    !loanId && Number.isFinite(amount) && amount > 0
      ? { amount, termDays: data.termDays }
      : undefined,
    {
      retry: false,
    },
  );
  const amortization = loanId ? amortizationQuery.data : previewQuery.data;
  const hasRequestedSchedule = Boolean(loanId);
  const hasPreviewSchedule = !loanId && Number.isFinite(amount) && amount > 0;
  const isLoading = loanId ? amortizationQuery.isLoading : previewQuery.isLoading;
  const isError = loanId ? amortizationQuery.isError : previewQuery.isError;

  return (
    <div className="space-y-6">
      {!amortization && (
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
            {isLoading && (
              <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading amortization schedule...
              </div>
            )}

            {!hasRequestedSchedule && !hasPreviewSchedule && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>Enter a valid loan amount and term to load the amortization schedule.</p>
              </div>
            )}

            {isError && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>Unable to load the amortization schedule.</p>
              </div>
            )}

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
      )}

      {amortization && (
        <>
          <RepaymentScheduleTable
            amortization={amortization}
            description={
              data.amount
                ? "Review how each payment is broken down before moving to collateral."
                : "Review your payment obligations before confirming."
            }
            showSummaryCards={false}
          />

          <div className="flex gap-3">
            <Button variant="outline" onClick={onBack} className="w-full">
              Back
            </Button>
            <Button onClick={onNext} className="w-full">
              Continue to Collateral
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
