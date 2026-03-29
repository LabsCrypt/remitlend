"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { WizardSkeleton } from "../components/skeletons/WizardSkeleton";
import { useCreditScore, useMinimumScore } from "../hooks/useApi";

const LoanApplicationWizard = lazy(() =>
  import("../components/loan-wizard/LoanApplicationWizard").then((m) => ({
    default: m.LoanApplicationWizard,
  })),
);
import { useToastStore } from "../stores/useToastStore";
import {
  useWalletStore,
  selectWalletAddress,
  selectIsWalletConnected,
} from "../stores/useWalletStore";

function getScoreBandMax(score: number): number {
  if (score >= 750) return 50_000;
  if (score >= 670) return 25_000;
  if (score >= 580) return 10_000;
  if (score >= 500) return 5_000;
  return 0;
}

export default function RequestLoanPage() {
  const borrowerAddress = useWalletStore(selectWalletAddress);
  const isWalletConnected = useWalletStore(selectIsWalletConnected);
  const [successLoanId, setSuccessLoanId] = useState<string | null>(null);
  const addToast = useToastStore((state) => state.addToast);
  const scoreErrorToastRef = useRef<string | null>(null);
  const configErrorToastRef = useRef<string | null>(null);

  const {
    data: minScoreConfig,
    isLoading: isLoadingConfig,
    error: configError,
  } = useMinimumScore({
    enabled: isWalletConnected,
  });
  const {
    data: creditScore,
    isLoading: isLoadingScore,
    error: scoreError,
  } = useCreditScore(borrowerAddress ?? undefined, {
    enabled: isWalletConnected && !!borrowerAddress,
  });

  useEffect(() => {
    if (scoreError && scoreError.message !== scoreErrorToastRef.current) {
      scoreErrorToastRef.current = scoreError.message;
      addToast({
        type: "error",
        title: "Could not load your credit score",
        description: scoreError.message,
      });
    }
  }, [scoreError, addToast]);

  useEffect(() => {
    if (configError && configError.message !== configErrorToastRef.current) {
      configErrorToastRef.current = configError.message;
      addToast({
        type: "error",
        title: "Could not load loan eligibility config",
        description: configError.message,
      });
    }
  }, [configError, addToast]);

  const minimumScore = minScoreConfig?.minScore ?? 500;
  const resolvedCreditScore = creditScore ?? 0;
  const maxAmount = Math.min(
    getScoreBandMax(resolvedCreditScore),
    minScoreConfig?.maxAmount ?? Number.POSITIVE_INFINITY,
  );
  const scoreDelta = resolvedCreditScore - minimumScore;
  const isCloseToMinimum = scoreDelta >= 0 && scoreDelta <= 40;
  const isIneligible = isWalletConnected && !isLoadingConfig && !isLoadingScore && scoreDelta < 0;
  const isCheckingEligibility =
    isWalletConnected && (isLoadingConfig || (isLoadingScore && !!borrowerAddress));

  const hasEligibilityError = Boolean(configError || scoreError);

  if (successLoanId) {
    return (
      <main className="mx-auto max-w-3xl space-y-6 p-8">
        <Card>
          <CardContent className="space-y-4 p-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              Loan Request Submitted
            </h1>
            <p className="text-zinc-600 dark:text-zinc-400">Request ID: {successLoanId}</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Next steps: monitor approval status and prepare repayment before the due date.
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <Link href="/loans">
                <Button variant="outline">View Loans</Button>
              </Link>
              <Button onClick={() => setSuccessLoanId(null)}>Request Another</Button>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-8 p-8">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
          Borrower Portal
        </p>
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">Request Loan</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Complete each step to configure your loan, preview repayment terms, confirm collateral,
          and sign your Soroban transaction.
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          If a transaction fails, you will now see clear guidance, retry actions for temporary
          issues, and status tracking for submitted transactions.
        </p>
      </header>

      {!isWalletConnected ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-zinc-500 dark:text-zinc-400">
              Connect your Stellar wallet to begin the loan application.
            </p>
          </CardContent>
        </Card>
      ) : isCheckingEligibility ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-zinc-700 dark:text-zinc-300">Checking eligibility...</p>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Fetching your latest score and loan requirements.
            </p>
          </CardContent>
        </Card>
      ) : hasEligibilityError ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-zinc-700 dark:text-zinc-300">Unable to verify eligibility.</p>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Please refresh and try again. If the issue persists, reconnect your wallet and retry.
            </p>
          </CardContent>
        </Card>
      ) : isIneligible ? (
        <Card>
          <CardContent className="space-y-4 py-10">
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              <Info className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="space-y-2">
                <p className="font-semibold">Loan eligibility check</p>
                <p className="text-sm">
                  Your credit score ({resolvedCreditScore}) is below the minimum ({minimumScore}).
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                How to improve your score
              </p>
              <ul className="mt-2 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                <li>Make repayments on time to gain positive score updates.</li>
                <li>Keep loan utilization low and avoid late payments.</li>
                <li>Repay active balances before applying again.</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {isCloseToMinimum && (
            <div className="flex items-start gap-3 rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-yellow-800 dark:border-yellow-900/50 dark:bg-yellow-950/30 dark:text-yellow-300">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">You are near the minimum score threshold</p>
                <p className="text-sm">
                  A score drop below {minimumScore} could make future requests ineligible.
                </p>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-zinc-700 dark:text-zinc-300">
              Eligibility: score {resolvedCreditScore} / minimum {minimumScore}
            </p>
            <p className="mt-1 text-zinc-500 dark:text-zinc-400">
              Maximum loan amount currently available: ${maxAmount.toLocaleString("en-US")}
            </p>
          </div>

          <Suspense fallback={<WizardSkeleton />}>
            <LoanApplicationWizard
              borrowerAddress={borrowerAddress!}
              creditScore={resolvedCreditScore}
              maxAmount={maxAmount}
              onSuccess={setSuccessLoanId}
            />
          </Suspense>
        </div>
      )}
    </main>
  );
}
