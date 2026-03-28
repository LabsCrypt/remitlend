"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { useCreditScoreHistory } from "../hooks/useApi";
import {
  useWalletStore,
  selectWalletAddress,
  selectIsWalletConnected,
} from "../stores/useWalletStore";

const LoanApplicationWizard = dynamic(
  () =>
    import("../components/loan-wizard/LoanApplicationWizard").then(
      (module) => module.LoanApplicationWizard,
    ),
  {
    loading: () => (
      <Card>
        <CardContent className="space-y-4 py-10">
          <div className="h-4 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-24 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
          <div className="h-24 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-900" />
        </CardContent>
      </Card>
    ),
    ssr: false,
  },
);

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

  const { data: scoreHistory } = useCreditScoreHistory(borrowerAddress ?? undefined, {
    enabled: !!borrowerAddress,
  });

  const creditScore = scoreHistory?.[scoreHistory.length - 1]?.score ?? 720;
  const maxAmount = getScoreBandMax(creditScore);

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
      ) : (
        <LoanApplicationWizard
          borrowerAddress={borrowerAddress!}
          creditScore={creditScore}
          maxAmount={maxAmount}
          onSuccess={setSuccessLoanId}
        />
      )}
    </main>
  );
}
