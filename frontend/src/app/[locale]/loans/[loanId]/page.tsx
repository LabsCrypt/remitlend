"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronRight, Clock, Download, Wallet } from "lucide-react";
import { LoanDetailSkeleton } from "../../../components/skeletons/LoanDetailSkeleton";
import { useLoan, type LoanDetails } from "../../../hooks/useApi";
import { RepaymentProgress } from "../../../components/ui/RepaymentProgress";
import { LoanTimeline } from "../../../components/ui/LoanTimeline";
import { TxHashLink } from "../../../components/ui/TxHashLink";
import { Button } from "../../../components/ui/Button";
import { downloadCsv } from "../../../utils/csv";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatDate(iso: string | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getDaysRemaining(deadline: string | undefined): number | null {
  if (!deadline) return null;
  const diff = new Date(deadline).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function formatLoanEventType(type: string): string {
  return type
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
}

function getLoanAsset(loan: LoanDetails): string {
  const loanWithAsset = loan as LoanDetails & { currency?: string; asset?: string };
  return loanWithAsset.currency ?? loanWithAsset.asset ?? "USD";
}

function buildLoanCsvRows(loan: LoanDetails) {
  const asset = getLoanAsset(loan);

  if (loan.events.length > 0) {
    return loan.events.map((event) => ({
      date: event.timestamp,
      type: formatLoanEventType(event.type),
      amount: event.amount,
      asset,
      status: loan.status,
      transaction_hash: event.txHash ?? "",
    }));
  }

  return [
    {
      date: loan.requestedAt ?? loan.approvedAt ?? new Date().toISOString(),
      type: "Loan Record",
      amount: loan.totalOwed,
      asset,
      status: loan.status,
      transaction_hash: "",
    },
  ];
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
          Loan #{loanId} could not be located. It may have been removed or the ID is incorrect.
        </p>
        <Link
          href="/loans"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Back to loans
        </Link>
      </section>
    );
  }

  const latestTxHash = loan.events.find((event) => Boolean(event.txHash))?.txHash;
  const nextDeadline = (loan as LoanDetails & { nextPaymentDeadline?: string }).nextPaymentDeadline;
  const daysRemaining = getDaysRemaining(nextDeadline);

  const handleExport = () => {
    downloadCsv(
      `loan-record-${loanId}-${new Date().toISOString().slice(0, 10)}.csv`,
      buildLoanCsvRows(loan),
    );
  };

  return (
    <section className="space-y-6">
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400"
      >
        <Link href="/" className="transition hover:text-zinc-900 dark:hover:text-zinc-100">
          Home
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link href="/loans" className="transition hover:text-zinc-900 dark:hover:text-zinc-100">
          Loans
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="font-medium text-zinc-900 dark:text-zinc-50">Loan #{loanId}</span>
      </nav>

      <header className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
              Borrower Portal
            </p>
            <h1 className="mt-3 text-3xl font-bold text-zinc-900 dark:text-zinc-50">
              Loan #{loanId}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
              Track repayment timing, lender terms, and the current outstanding balance for this loan.
            </p>
          </div>
          <Button
            variant="outline"
            leftIcon={<Download className="h-4 w-4" />}
            onClick={handleExport}
          >
            Export CSV
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-500 dark:text-zinc-400">
          {loan.interestRate > 0 && (
            <span>
              Interest rate:{" "}
              <strong className="text-zinc-900 dark:text-zinc-50">
                {loan.interestRate.toFixed(2)}%
              </strong>
            </span>
          )}
          {loan.requestedAt && (
            <span>
              Requested:{" "}
              <strong className="text-zinc-900 dark:text-zinc-50">
                {formatDate(loan.requestedAt)}
              </strong>
            </span>
          )}
          {loan.approvedAt && (
            <span>
              Approved:{" "}
              <strong className="text-zinc-900 dark:text-zinc-50">
                {formatDate(loan.approvedAt)}
              </strong>
            </span>
          )}
        </div>
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

          <div className="mt-6">
            <RepaymentProgress
              totalRepaid={loan.totalRepaid}
              totalOwed={loan.totalOwed}
              status={loan.status}
            />
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Repayment timeline
            </h3>
            <div className="mt-3">
              <LoanTimeline events={loan.events} />
            </div>
          </div>
        </article>

        <aside className="space-y-4">
          {loan.status === "active" && daysRemaining !== null && (
            <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
              <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                <Clock className="h-4 w-4" />
                <h2 className="text-sm font-semibold">Next payment due</h2>
              </div>
              <p
                className={`mt-2 text-2xl font-bold ${
                  daysRemaining <= 3
                    ? "text-red-600 dark:text-red-400"
                    : daysRemaining <= 7
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-zinc-900 dark:text-zinc-50"
                }`}
              >
                {daysRemaining <= 0
                  ? "Overdue"
                  : daysRemaining === 1
                    ? "Due tomorrow"
                    : `${daysRemaining} days`}
              </p>
              {nextDeadline && (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {new Date(nextDeadline).toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
              )}
            </div>
          )}

          <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
            <div className="rounded-2xl bg-indigo-50 p-5 dark:bg-indigo-500/10">
              <div className="flex items-center gap-3 text-indigo-700 dark:text-indigo-300">
                <Wallet className="h-5 w-5" />
                <h2 className="text-lg font-semibold">Next action</h2>
              </div>
              <p className="mt-3 text-sm leading-6 text-indigo-700/80 dark:text-indigo-200">
                Make a repayment before the next due date to keep your score trending upward.
              </p>
              {loan.status !== "repaid" && (
                <Link
                  href={`/repay/${loanId}`}
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
                >
                  Make Payment
                  <ChevronRight className="h-4 w-4" />
                </Link>
              )}

              {latestTxHash && (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-medium text-indigo-700/70 dark:text-indigo-300/70">
                    Latest transaction
                  </p>
                  <TxHashLink txHash={latestTxHash} />
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Collateral status
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {loan.status === "defaulted"
                ? "Collateral has been seized."
                : loan.status === "repaid"
                  ? "Collateral released — loan fully repaid."
                  : "Collateral is held in escrow for the duration of this loan."}
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
