"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarRange, CircleDollarSign, ShieldCheck } from "lucide-react";
import { ErrorBoundary } from "../components/global_ui/ErrorBoundary";
import { LoansListSkeleton } from "../components/skeletons/LoansListSkeleton";
import { useBorrowerLoans } from "../hooks/useApi";
import { useWalletStore, selectWalletAddress } from "../stores/useWalletStore";

const PAGE_SIZE = 6;

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function getLoanDisplayStatus(status: string, nextPaymentDeadline: string, now: number) {
  if (status !== "active") {
    return status;
  }
  return new Date(nextPaymentDeadline).getTime() < now ? "defaulted" : "active";
}

export default function LoansPage() {
  const [activeTab, setActiveTab] = useState<"all" | "active" | "repaid" | "defaulted">("all");
  const [page, setPage] = useState(1);
  const [now] = useState(() => Date.now());
  const address = useWalletStore(selectWalletAddress);
  const { loans, stats, isLoading, isError } = useBorrowerLoans(address ?? undefined);

  const filteredLoans = useMemo(() => {
    const enriched = loans.map((loan) => ({
      ...loan,
      displayStatus: getLoanDisplayStatus(loan.status, loan.nextPaymentDeadline, now),
    }));

    if (activeTab === "all") {
      return enriched;
    }

    return enriched.filter((loan) => loan.displayStatus === activeTab);
  }, [activeTab, loans, now]);

  const totalPages = Math.max(1, Math.ceil(filteredLoans.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedLoans = filteredLoans.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const dueThisWeek = loans.filter((loan) => {
    const dueAt = new Date(loan.nextPaymentDeadline).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    return dueAt >= now && dueAt <= now + sevenDays;
  }).length;

  const portfolioHealth =
    stats.overdueCount === 0 ? "Strong" : stats.overdueCount <= 2 ? "Watch" : "At Risk";

  if (isLoading) {
    return <LoansListSkeleton />;
  }

  if (isError) {
    return (
      <section className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
        Failed to load loans. Please reconnect your wallet and try again.
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
            Borrower Portal
          </p>
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">Loans</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            Review active facilities, due dates, and repayment windows from one place.
          </p>
        </div>
        <Link
          href="/request-loan"
          className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
        >
          Request Loan
          <ArrowRight className="h-4 w-4" />
        </Link>
      </header>

      <ErrorBoundary scope="loan summary cards" variant="section">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              label: "Outstanding",
              value: formatCurrency(stats.totalOwed),
              icon: CircleDollarSign,
            },
            {
              label: "Due This Week",
              value: `${dueThisWeek} loan${dueThisWeek === 1 ? "" : "s"}`,
              icon: CalendarRange,
            },
            { label: "Portfolio Health", value: portfolioHealth, icon: ShieldCheck },
          ].map((item) => (
            <article
              key={item.label}
              className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-indigo-50 p-3 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
                  <item.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">{item.label}</p>
                  <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {item.value}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </ErrorBoundary>

      <ErrorBoundary scope="loan list" variant="section">
        <div className="space-y-4 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
          <div className="flex flex-wrap gap-2">
            {[
              { key: "all", label: "All" },
              { key: "active", label: "Active" },
              { key: "repaid", label: "Repaid" },
              { key: "defaulted", label: "Defaulted" },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key as typeof activeTab);
                  setPage(1);
                }}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  activeTab === tab.key
                    ? "bg-indigo-600 text-white"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {paginatedLoans.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-10 text-center dark:border-zinc-700">
              <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                No loans found
              </p>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                You do not have loans in this category yet.
              </p>
              <Link
                href="/request-loan"
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                Request a loan
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {paginatedLoans.map((loan) => (
                <article
                  key={loan.id}
                  className="flex flex-col gap-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                      Loan #{loan.id}
                    </p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">{loan.borrower}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="rounded-full bg-zinc-100 px-3 py-1 font-medium capitalize text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                      {loan.displayStatus}
                    </span>
                    <span className="text-zinc-600 dark:text-zinc-400">
                      {formatCurrency(loan.totalOwed)}
                    </span>
                    <span className="text-zinc-600 dark:text-zinc-400">
                      Due {new Date(loan.nextPaymentDeadline).toLocaleDateString()}
                    </span>
                  </div>
                  <Link
                    href={`/loans/${loan.id}`}
                    className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    View details
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </article>
              ))}
            </div>
          )}

          {paginatedLoans.length > 0 && totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="rounded-full border border-zinc-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700"
              >
                Prev
              </button>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="rounded-full border border-zinc-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </ErrorBoundary>
    </section>
  );
}
