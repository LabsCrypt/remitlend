"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ChevronRight, Clock, ExternalLink, Wallet } from "lucide-react";
import { LoanDetailSkeleton } from "../../../components/skeletons/LoanDetailSkeleton";
import { useLoan } from "../../../hooks/useApi";
import { RepaymentProgress } from "../../../components/ui/RepaymentProgress";
import { LoanTimeline } from "../../../components/ui/LoanTimeline";
import { TxHashLink } from "../../../components/ui/TxHashLink";

const SUPPORT_URL = "https://t.me/+DOylgFv1jyJlNzM0";

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
  const nextDeadline = (loan as unknown as { nextPaymentDeadline?: string }).nextPaymentDeadline;
  const daysRemaining = getDaysRemaining(nextDeadline);
  const isDefaulted = loan.status === "defaulted";
  const penaltyFees = Math.max(loan.totalOwed - (loan.principal + loan.accruedInterest), 0);
  const collateralSeized = loan.events.some((event) => event.type === "Seized");

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
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
          Borrower Portal
        </p>
        <h1 className="mt-3 text-3xl font-bold text-zinc-900 dark:text-zinc-50">
          Loan #{loanId}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
          Track repayment timing, lender terms, and the current outstanding balance for this loan.
        </p>

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

        {isDefaulted && (
          <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-900/60 dark:bg-amber-950/20">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-amber-100 p-2 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                    Defaulted loan
                  </p>
                  <p className="mt-2 text-sm leading-6 text-amber-900/85 dark:text-amber-100/85">
                    This loan has entered default. Review the recovery details below and contact
                    support if you need a repayment plan review or want to raise a dispute.
                  </p>
                </div>
              </div>
              <a
                href={SUPPORT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-500"
              >
                Contact Support
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-white p-4 dark:bg-zinc-950/70">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  Outstanding amount
                </p>
                <p className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  {formatCurrency(loan.totalOwed)}
                </p>
              </div>
              <div className="rounded-xl bg-white p-4 dark:bg-zinc-950/70">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  Penalty fees
                </p>
                <p className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  {formatCurrency(penaltyFees)}
                </p>
              </div>
              <div className="rounded-xl bg-white p-4 dark:bg-zinc-950/70">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  Collateral seizure status
                </p>
                <p className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {collateralSeized
                    ? "Collateral has been seized."
                    : "Collateral is still in review while recovery options are evaluated."}
                </p>
              </div>
            </div>
          </div>
        )}
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <article className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Repayment plan
          </h2>

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
            <div
              className={`rounded-2xl p-5 ${
                isDefaulted
                  ? "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-100"
                  : "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-200"
              }`}
            >
              <div className="flex items-center gap-3">
                <Wallet className="h-5 w-5" />
                <h2 className="text-lg font-semibold">
                  {isDefaulted ? "Recovery options" : "Next action"}
                </h2>
              </div>
              <p className="mt-3 text-sm leading-6">
                {isDefaulted
                  ? "Support can help review repayment options, dispute next steps, and explain what happens to your collateral."
                  : "Make a repayment before the next due date to keep your score trending upward."}
              </p>
              {isDefaulted ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <a
                    href={SUPPORT_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-500"
                  >
                    Contact Support
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  <a
                    href={SUPPORT_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950/30"
                  >
                    Open Dispute Flow
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
              ) : loan.status !== "repaid" ? (
                <Link
                  href={`/repay/${loanId}`}
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
                >
                  Make Payment
                  <ChevronRight className="h-4 w-4" />
                </Link>
              ) : null}

              {latestTxHash && (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-medium opacity-75">Latest transaction</p>
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
                ? collateralSeized
                  ? "Collateral has been seized."
                  : "Collateral remains locked while the default review is in progress."
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
