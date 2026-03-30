"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarRange,
  CircleDollarSign,
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { ErrorBoundary } from "../../components/global_ui/ErrorBoundary";
import { LoansListSkeleton } from "../../components/skeletons/LoansListSkeleton";
import { useBorrowerLoans } from "../../hooks/useApi";
import { LoanStatusBadge } from "../../components/ui/LoanStatusBadge";
import { useWalletStore, selectWalletAddress } from "../../stores/useWalletStore";
import { useTranslations, useLocale } from "next-intl";

const PAGE_SIZE = 6;
const SUPPORT_URL = "https://t.me/+DOylgFv1jyJlNzM0";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function getLoanDisplayStatus(status: string, nextPaymentDeadline: string, now: number) {
  if (status !== "active") {
    return status;
  }
  return new Date(nextPaymentDeadline).getTime() < now ? "defaulted" : "active";
}

function getPenaltyFees(totalOwed: number, principal: number, accruedInterest: number) {
  return Math.max(totalOwed - (principal + accruedInterest), 0);
}

export default function LoansPage() {
  const t = useTranslations("Loans");
  const locale = useLocale();
  const [activeTab, setActiveTab] = useState<"all" | "active" | "repaid" | "defaulted">("all");
  const [page, setPage] = useState(1);
  const [now] = useState(() => Date.now());
  const address = useWalletStore(selectWalletAddress);
  const { loans, stats, isLoading, isError } = useBorrowerLoans(address ?? undefined);

  const filteredLoans = useMemo(() => {
    const enriched = (loans || []).map((loan) => ({
      ...loan,
      displayStatus: getLoanDisplayStatus(loan.status, loan.nextPaymentDeadline, now),
      penaltyFees: getPenaltyFees(loan.totalOwed, loan.principal, loan.accruedInterest),
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
              {paginatedLoans.map((loan) => {
                const isDefaulted = loan.displayStatus === "defaulted";
                const seizureStatus = loan.status === "defaulted"
                  ? "Collateral seizure review has started."
                  : "Collateral remains locked while support reviews recovery options.";

                return (
                  <article
                    key={loan.id}
                    className={`flex flex-col gap-4 rounded-2xl border p-4 md:flex-row md:items-center md:justify-between ${
                      isDefaulted
                        ? "border-amber-300 bg-amber-50/80 shadow-sm shadow-amber-100 dark:border-amber-900/60 dark:bg-amber-950/20 dark:shadow-none"
                        : "border-zinc-200 dark:border-zinc-800"
                    }`}
                  >
                    <div className="space-y-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                            {t("loanNumber", { id: loan.id })}
                          </p>
                          <LoanStatusBadge status={loan.displayStatus} />
                        </div>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">{loan.borrower}</p>
                      </div>

                      {isDefaulted ? (
                        <div className="space-y-3 rounded-2xl border border-amber-200 bg-white/80 p-4 dark:border-amber-900/50 dark:bg-zinc-950/40">
                          <div className="flex items-start gap-3">
                            <div className="rounded-full bg-amber-100 p-2 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                              <AlertTriangle className="h-4 w-4" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                                Recovery options available
                              </p>
                              <p className="mt-1 text-sm text-amber-800/80 dark:text-amber-200/80">
                                This loan is in default. Review the outstanding balance, confirm collateral status, and contact support to discuss repayment or dispute options.
                              </p>
                            </div>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-3">
                            <div className="rounded-xl bg-amber-50 p-3 dark:bg-amber-500/10">
                              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                                Outstanding amount
                              </p>
                              <p className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                                {formatCurrency(loan.totalOwed)}
                              </p>
                            </div>
                            <div className="rounded-xl bg-amber-50 p-3 dark:bg-amber-500/10">
                              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                                Penalty fees
                              </p>
                              <p className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                                {formatCurrency(loan.penaltyFees)}
                              </p>
                            </div>
                            <div className="rounded-xl bg-amber-50 p-3 dark:bg-amber-500/10">
                              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                                Collateral status
                              </p>
                              <p className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                                {seizureStatus}
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-3 text-sm">
                          <span className="text-zinc-600 dark:text-zinc-400">
                            {formatCurrency(loan.totalOwed)}
                          </span>
                          <span className="text-zinc-600 dark:text-zinc-400">
                            {t("due", { date: new Date(loan.nextPaymentDeadline).toLocaleDateString() })}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-3 md:items-end">
                      {isDefaulted ? (
                        <>
                          <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
                            <ShieldAlert className="h-3.5 w-3.5" />
                            Defaulted loans need manual review
                          </div>
                          <div className="flex flex-wrap gap-2 md:justify-end">
                            <Link
                              href={`/${locale}/loans/${loan.id}`}
                              className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                            >
                              View Recovery Options
                              <ArrowRight className="h-4 w-4" />
                            </Link>
                            <a
                              href={SUPPORT_URL}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 dark:border-amber-800 dark:bg-zinc-950 dark:text-amber-200 dark:hover:bg-amber-950/30"
                            >
                              Contact Support
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </div>
                        </>
                      ) : (
                        <Link
                          href={`/${locale}/loans/${loan.id}`}
                          className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                        >
                          {t("viewDetails")}
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {paginatedLoans.length > 0 && totalPages > 1 && (
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="rounded-full border border-zinc-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700"
              >
                {t("pagination.prev")}
              </button>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                {t("pagination.pageOf", { current: currentPage, total: totalPages })}
              </span>
              <button
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="rounded-full border border-zinc-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700"
              >
                {t("pagination.next")}
              </button>
            </div>
          )}
        </div>
      </ErrorBoundary>
    </section>
  );
}
