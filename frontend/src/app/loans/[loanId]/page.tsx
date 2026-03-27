"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronRight, ExternalLink, Wallet } from "lucide-react";
import { LoanDetailSkeleton } from "../../components/skeletons/LoanDetailSkeleton";
import { useLoan } from "../../hooks/useApi";
import { LoanStatusBadge } from "../../components/ui/LoanStatusBadge";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export default function LoanDetailsPage() {
  const params = useParams<{ loanId: string }>();
  const loanId = params.loanId;
  const { data: loan, isLoading, isError } = useLoan(loanId);

  if (isLoading) {
    return <LoanDetailSkeleton />;
  }

  if (isError) {
    return (
      <section className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
        Failed to fetch loan details. Please try again.
      </section>
    );
  }

  if (!loan) {
    return (
      <section className="rounded-3xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Loan not found</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          The requested loan could not be located.
        </p>
        <Link
          href="/loans"
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Back to loans
        </Link>
      </section>
    );
  }

  const progress =
    loan.totalOwed > 0
      ? Math.min((loan.totalRepaid / (loan.totalRepaid + loan.totalOwed)) * 100, 100)
      : 100;
  const latestTxHash = loan.events.find((event) => Boolean(event.txHash))?.txHash;

  return (
    <section className="space-y-6">
      <header className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
          Borrower Portal
        </p>
        <h1 className="mt-3 text-3xl font-bold text-zinc-900 dark:text-zinc-50">Loan #{loanId}</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
          Track repayment timing, lender terms, and the current outstanding balance for this loan.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <article className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Repayment plan</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {[
              ["Principal", formatCurrency(loan.principal)],
              ["Interest accrued", formatCurrency(loan.accruedInterest)],
              ["Total repaid", formatCurrency(loan.totalRepaid)],
              ["Total owed", formatCurrency(loan.totalOwed)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
                <p className="mt-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  {value}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Repayment progress</p>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {progress.toFixed(1)}%
              </p>
            </div>
            <div className="h-2 w-full rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div className="h-2 rounded-full bg-indigo-600" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">Status:</p>
              <LoanStatusBadge status={loan.status} />
            </div>
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Repayment timeline
            </h3>
            <div className="mt-3 space-y-3">
              {loan.events.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">No events yet.</p>
              ) : (
                loan.events.map((event, index) => (
                  <div
                    key={`${event.type}-${event.timestamp}-${index}`}
                    className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                        {event.type}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {new Date(event.timestamp).toLocaleString()}
                      </p>
                    </div>
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                      Amount: {formatCurrency(Number(event.amount) || 0)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </article>

        <aside className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
          <div className="rounded-2xl bg-indigo-50 p-5 dark:bg-indigo-500/10">
            <div className="flex items-center gap-3 text-indigo-700 dark:text-indigo-300">
              <Wallet className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Next action</h2>
            </div>
            <p className="mt-3 text-sm leading-6 text-indigo-700/80 dark:text-indigo-200">
              Make a repayment before the next due date to keep your score trending upward.
            </p>
            <Link
              href={`/repay/${loanId}`}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
            >
              Make Payment
              <ChevronRight className="h-4 w-4" />
            </Link>

            {latestTxHash && (
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${latestTxHash}`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-2 rounded-full border border-indigo-300 px-4 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-700 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
              >
                View on Explorer
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
