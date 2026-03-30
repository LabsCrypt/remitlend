"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarRange, CircleDollarSign, ShieldCheck } from "lucide-react";
import { ErrorBoundary } from "../../components/global_ui/ErrorBoundary";
import { LoansListSkeleton } from "../../components/skeletons/LoansListSkeleton";
import { useBorrowerLoans, usePaginatedBorrowerLoans } from "../../hooks/useApi";
import { LoanStatusBadge } from "../../components/ui/LoanStatusBadge";
import { useWalletStore, selectWalletAddress } from "../../stores/useWalletStore";
import { useTranslations, useLocale } from "next-intl";

const PAGE_SIZE = 20;

function getPageNumbers(currentPage: number, totalPages: number): number[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
  return Array.from({ length: 5 }, (_, index) => start + index);
}

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
  const t = useTranslations("Loans");
  const locale = useLocale();
  const [activeTab, setActiveTab] = useState<"all" | "active" | "repaid" | "defaulted">("all");
  const [page, setPage] = useState(1);
  const [cursorByPage, setCursorByPage] = useState<Record<number, string | null>>({ 1: null });
  const [now] = useState(() => Date.now());
  const address = useWalletStore(selectWalletAddress);
  const { loans, stats, isLoading, isError } = useBorrowerLoans(address ?? undefined);
  const {
    loans: paginatedLoans,
    total,
    pageInfo,
    isFetching,
  } = usePaginatedBorrowerLoans({
    borrowerAddress: address ?? undefined,
    limit: PAGE_SIZE,
    cursor: cursorByPage[page] ?? null,
    status: activeTab,
  });

  const visibleLoans = useMemo(() => {
    return paginatedLoans.map((loan) => ({
      ...loan,
      displayStatus: getLoanDisplayStatus(loan.status, loan.nextPaymentDeadline, now),
    }));
  }, [now, paginatedLoans]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visiblePageNumbers = getPageNumbers(currentPage, totalPages);
  const dueThisWeek = (loans || []).filter((loan) => {
    const dueAt = new Date(loan.nextPaymentDeadline).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    return dueAt >= now && dueAt <= now + sevenDays;
  }).length;

  const portfolioHealth = useMemo(() => {
    if (!stats || stats.overdueCount === 0) return t("health.strong");
    if (stats.overdueCount <= 2) return t("health.watch");
    return t("health.atRisk");
  }, [stats, t]);

  useEffect(() => {
    if (!pageInfo?.next_cursor) {
      return;
    }

    setCursorByPage((prev) => {
      if (prev[currentPage + 1] === pageInfo.next_cursor) {
        return prev;
      }

      return {
        ...prev,
        [currentPage + 1]: pageInfo.next_cursor,
      };
    });
  }, [currentPage, pageInfo?.next_cursor]);

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
            {t("borrowerPortal")}
          </p>
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">{t("title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            {t("description")}
          </p>
        </div>
      </header>

      <ErrorBoundary scope="loan summary cards" variant="section">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              label: t("outstanding"),
              value: formatCurrency(stats?.totalOwed || 0),
              icon: CircleDollarSign,
            },
            {
              label: t("dueThisWeek"),
              value: `${dueThisWeek} loan${dueThisWeek === 1 ? "" : "s"}`,
              icon: CalendarRange,
            },
            { label: t("portfolioHealth"), value: portfolioHealth, icon: ShieldCheck },
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
              { key: "all", label: t("tabs.all") },
              { key: "active", label: t("tabs.active") },
              { key: "repaid", label: t("tabs.repaid") },
              { key: "defaulted", label: t("tabs.defaulted") },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key as typeof activeTab);
                  setPage(1);
                  setCursorByPage({ 1: null });
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

          {visibleLoans.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-10 text-center dark:border-zinc-700">
              <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                {t("empty.title")}
              </p>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                {t("empty.description")}
              </p>
              <Link
                href={`/${locale}`}
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                {t("empty.action")}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleLoans.map((loan) => (
                <article
                  key={loan.id}
                  className="flex flex-col gap-4 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                      {t("loanNumber", { id: loan.id })}
                    </p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">{loan.borrower}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <LoanStatusBadge status={loan.displayStatus} />
                    <span className="text-zinc-600 dark:text-zinc-400">
                      {formatCurrency(loan.totalOwed)}
                    </span>
                    <span className="text-zinc-600 dark:text-zinc-400">
                      {t("due", { date: new Date(loan.nextPaymentDeadline).toLocaleDateString() })}
                    </span>
                  </div>
                  <Link
                    href={`/${locale}/loans/${loan.id}`}
                    className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    {t("viewDetails")}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </article>
              ))}
            </div>
          )}

          {visibleLoans.length > 0 && totalPages > 1 && (
            <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                {t("pagination.pageOf", { current: currentPage, total: totalPages })}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1 || isFetching}
                  className="rounded-full border border-zinc-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700"
                >
                  {t("pagination.prev")}
                </button>
                {visiblePageNumbers.map((pageNumber) => {
                  const isKnownPage = pageNumber === 1 || cursorByPage[pageNumber] !== undefined;

                  return (
                    <button
                      key={pageNumber}
                      onClick={() => setPage(pageNumber)}
                      disabled={!isKnownPage || isFetching}
                      className={`h-9 w-9 rounded-full border text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                        currentPage === pageNumber
                          ? "border-indigo-600 bg-indigo-600 text-white"
                          : "border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                      }`}
                    >
                      {pageNumber}
                    </button>
                  );
                })}
                <button
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={
                    !pageInfo?.has_next || cursorByPage[currentPage + 1] === undefined || isFetching
                  }
                  className="rounded-full border border-zinc-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700"
                >
                  {t("pagination.next")}
                </button>
              </div>
            </div>
          )}
        </div>
      </ErrorBoundary>
    </section>
  );
}
