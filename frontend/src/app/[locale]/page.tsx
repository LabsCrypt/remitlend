"use client";

import {
  ArrowUpRight,
  ArrowDownLeft,
  Users,
  Activity,
  Clock,
  ExternalLink,
  WalletCards,
} from "lucide-react";
import { useTranslations } from "next-intl"; // <--- This is the new one
import { useRouter } from "next/navigation";
import {
  useWalletStore,
  selectIsWalletConnected,
  selectWalletAddress,
} from "../stores/useWalletStore";
import { useWallet } from "../components/providers/WalletProvider";
import {
  useLoans,
  useRemittances,
  useUserBalance,
  useUserProfile,
  useCreditScoreHistory,
  useScoreBreakdown,
} from "../hooks/useApi";
import { DashboardSkeleton } from "../components/skeletons/DashboardSkeleton";
import { CreditScoreGauge } from "../components/ui/CreditScoreGauge";
import { EmptyState } from "../components/ui/EmptyState";
import { CreditScoreBreakdown } from "../components/ui/CreditScoreBreakdown";
import { ErrorBoundary } from "../components/global_ui/ErrorBoundary";
import { Tooltip } from "../components/ui/Tooltip";
import React, { useMemo, useState, useEffect } from "react";
import type { Loan } from "../hooks/useApi";

const SEVENTY_TWO_HOURS_MS = 72 * 60 * 60 * 1000;
const SESSION_BANNER_KEY = "repayment_banner_dismissed";

/**
 * Returns the backend-authoritative due date for a loan.
 * Prefers `nextPaymentDeadline` (set by the backend, accounts for approval
 * time and rollovers) and only falls back to the client-side estimate when
 * the field is absent (e.g. from an older cached response).
 */
function getLoanDueDate(loan: Loan): Date {
  if (loan.nextPaymentDeadline) {
    return new Date(loan.nextPaymentDeadline);
  }
  // Fallback: approximate from creation time + term (may drift from truth)
  return new Date(new Date(loan.createdAt).getTime() + loan.termDays * 24 * 60 * 60 * 1000);
}

function useRepaymentReminder(loans: Loan[] | undefined) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem(SESSION_BANNER_KEY) === "true") {
      setDismissed(true);
    }
  }, []);

  const urgentLoans = useMemo(() => {
    if (!loans) return [];
    const now = Date.now();
    return loans
      .filter((l) => {
        if (l.status !== "active") return false;
        const due = getLoanDueDate(l).getTime();
        // Include both overdue loans (due <= now) and those due within 72 h
        return due - now <= SEVENTY_TWO_HOURS_MS;
      })
      .sort((a, b) => getLoanDueDate(a).getTime() - getLoanDueDate(b).getTime());
  }, [loans]);

  const dismiss = () => {
    sessionStorage.setItem(SESSION_BANNER_KEY, "true");
    setDismissed(true);
  };

  return { urgentLoans, dismissed, dismiss };
}

function RepaymentReminderBanner({
  urgentLoans,
  onDismiss,
}: {
  urgentLoans: Loan[];
  onDismiss: () => void;
}) {
  const router = useRouter();
  const t = useTranslations("HomePage");
  const mostUrgent = urgentLoans[0];
  if (!mostUrgent) return null;

  const dueDate = getLoanDueDate(mostUrgent);
  const msLeft = dueDate.getTime() - Date.now();
  const isOverdue = msLeft <= 0;
  const hoursLeft = isOverdue ? 0 : Math.floor(msLeft / (60 * 60 * 1000));

  const bannerColor = isOverdue
    ? "border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-950/30"
    : "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-950/30";
  const iconColor = isOverdue
    ? "text-red-600 dark:text-red-400"
    : "text-amber-600 dark:text-amber-400";
  const headingColor = isOverdue
    ? "text-red-900 dark:text-red-200"
    : "text-amber-900 dark:text-amber-200";
  const subColor = isOverdue
    ? "text-red-700 dark:text-red-400"
    : "text-amber-700 dark:text-amber-400";
  const badgeColor = isOverdue
    ? "bg-red-200 text-red-800 dark:bg-red-500/30 dark:text-red-300"
    : "bg-amber-200 text-amber-800 dark:bg-amber-500/30 dark:text-amber-300";
  const btnColor = isOverdue
    ? "bg-red-600 hover:bg-red-700"
    : "bg-amber-600 hover:bg-amber-700";
  const dismissColor = isOverdue
    ? "text-red-600 hover:bg-red-100 dark:hover:bg-red-500/20"
    : "text-amber-600 hover:bg-amber-100 dark:hover:bg-amber-500/20";

  return (
    <div
      role="alert"
      className={`flex items-start justify-between gap-4 rounded-xl border px-5 py-4 ${bannerColor}`}
    >
      <div className="flex items-start gap-3">
        <Clock
          className={`mt-0.5 h-5 w-5 shrink-0 ${iconColor}`}
          aria-hidden="true"
        />
        <div>
          <p className={`text-sm font-semibold ${headingColor}`}>
            {isOverdue
              ? `Repayment overdue — Loan #${mostUrgent.id}`
              : t("reminder.due", { hours: hoursLeft, loanId: mostUrgent.id })}
            {urgentLoans.length > 1 && (
              <span className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${badgeColor}`}>
                +{urgentLoans.length - 1} more
              </span>
            )}
          </p>
          <p className={`mt-0.5 text-xs ${subColor}`}>
            Amount due:{" "}
            {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
              mostUrgent.amount,
            )}{" "}
            · Due{" "}
            {dueDate.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => router.push(`/repay/${mostUrgent.id}`)}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors ${btnColor}`}
        >
          {t("reminder.repayNow")}
        </button>
        <button
          onClick={onDismiss}
          aria-label={t("reminder.dismiss")}
          className={`rounded p-1 transition-colors ${dismissColor}`}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export default function Home() {
  const t = useTranslations("HomePage");
  const router = useRouter();
  const isConnected = useWalletStore(selectIsWalletConnected);
  const address = useWalletStore(selectWalletAddress);
  const { connectWallet } = useWallet();

  const { data: loans, isLoading: loansLoading } = useLoans({ enabled: isConnected });
  const { data: remittances, isLoading: remittancesLoading } = useRemittances({
    enabled: isConnected,
  });
  const { data: balance, isLoading: balanceLoading } = useUserBalance({
    enabled: isConnected,
  });
  const { data: userProfile } = useUserProfile({ enabled: isConnected });
  const { data: creditHistory } = useCreditScoreHistory(userProfile?.id, {
    enabled: isConnected && !!userProfile?.id,
  });

  const isLoading = (loansLoading || remittancesLoading || balanceLoading) && isConnected;

  const { urgentLoans, dismissed, dismiss } = useRepaymentReminder(loans);

  const currentCreditScore = useMemo(() => {
    if (!creditHistory || creditHistory.length === 0) return null;
    return creditHistory[creditHistory.length - 1].score;
  }, [creditHistory]);

  const previousCreditScore = useMemo(() => {
    if (!creditHistory || creditHistory.length < 2) return null;
    return creditHistory[creditHistory.length - 2].score;
  }, [creditHistory]);

  const stats = useMemo(() => {
    if (!isConnected) {
      return {
        netWorth: formatCurrency(0),
        activeLoans: "0",
        activeLoansSub: "0 pending",
        totalRemitted: formatCurrency(0),
        yieldApy: "0.0%",
      };
    }

    const activeLoans = loans?.filter((l) => l.status === "active") ?? [];
    const activeCount = activeLoans.length;
    const pendingCount = loans?.filter((l) => l.status === "pending").length ?? 0;

    const totalRemitted =
      remittances?.filter((r) => r.status === "completed").reduce((sum, r) => sum + r.amount, 0) ??
      0;

    const netWorth = (balance?.available ?? 0) + (balance?.locked ?? 0);

    const avgRate =
      activeLoans.length > 0
        ? activeLoans.reduce((sum, l) => sum + l.interestRate, 0) / activeLoans.length
        : 0;

    return {
      netWorth: formatCurrency(netWorth),
      activeLoans: String(activeCount),
      activeLoansSub: pendingCount > 0 ? `${pendingCount} pending` : "0 pending",
      totalRemitted: formatCurrency(totalRemitted),
      yieldApy: `${avgRate.toFixed(1)}%`,
    };
  }, [loans, remittances, balance, isConnected]);

  const recentActivity = useMemo(() => {
    const loanEvents =
      loans?.slice(0, 3).map((l) => ({
        type:
          l.status === "active"
            ? "Loan Active"
            : l.status === "repaid"
              ? "Loan Repaid"
              : "Loan Request",
        desc: `Loan #${l.id} — ${formatCurrency(l.amount)}`,
        amount: l.status === "repaid" ? `+${formatCurrency(l.amount)}` : formatCurrency(l.amount),
        time: new Date(l.createdAt).toLocaleDateString(),
        status: l.status === "repaid" ? "completed" : l.status,
      })) ?? [];

    const remittanceEvents =
      remittances?.slice(0, 3).map((r) => ({
        type: "Remittance",
        desc: `To ${r.recipientAddress.slice(0, 6)}...${r.recipientAddress.slice(-4)}`,
        amount: `-${formatCurrency(r.amount)}`,
        time: new Date(r.createdAt).toLocaleDateString(),
        status: r.status,
      })) ?? [];

    return [...loanEvents, ...remittanceEvents]
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 5);
  }, [loans, remittances]);

  if (!isConnected) {
    return (
      <main className="space-y-8 min-h-screen p-8 lg:p-12 max-w-7xl mx-auto animate-in fade-in duration-500">
        <header>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {t("disconnected.heading")}
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400">{t("disconnected.subheading")}</p>
        </header>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 opacity-50 grayscale-[0.5]">
          {(
            [
              t("stats.netWorth"),
              t("stats.activeLoans"),
              t("stats.totalRemitted"),
              t("stats.yieldApy"),
            ] as string[]
          ).map((label, i) => (
            <div
              key={i}
              className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
              <h3 className="text-2xl font-bold text-zinc-300 dark:text-zinc-700">$0.00</h3>
            </div>
          ))}
        </section>

        <div className="rounded-2xl bg-zinc-50 p-12 text-center dark:bg-zinc-900/50 border border-dashed border-zinc-200 dark:border-zinc-800">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 mb-6">
            <WalletCards className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
          </div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
            {t("disconnected.walletNotConnected")}
          </h2>
          <p className="mt-2 text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto">
            {t("disconnected.connectPrompt")}
          </p>
          <button
            onClick={() => {
              void connectWallet();
            }}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20"
          >
            {t("disconnected.connectButton")}
          </button>
        </div>
      </main>
    );
  }

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  const shortAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";

  return (
    <main
      className="space-y-8 min-h-screen p-8 lg:p-12 max-w-7xl mx-auto"
      aria-labelledby="dashboard-title"
    >
      <header>
        <h1 id="dashboard-title" className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          {t("title", { address: shortAddress })}
        </h1>
        <p className="text-zinc-500 dark:text-zinc-400">{t("description")}</p>
      </header>

      {!dismissed && urgentLoans.length > 0 && (
        <RepaymentReminderBanner urgentLoans={urgentLoans} onDismiss={dismiss} />
      )}

      <ErrorBoundary scope="dashboard summary" variant="section">
        <section
          aria-label="Portfolio Statistics"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {[
            {
              label: t("stats.netWorth"),
              value: stats.netWorth,
              change: balance ? `${formatCurrency(balance.available)} available` : "",
              icon: Activity,
              trend: "up" as const,
            },
            {
              label: t("stats.activeLoans"),
              value: stats.activeLoans,
              change: stats.activeLoansSub,
              icon: Users,
              trend: "neutral" as const,
            },
            {
              label: t("stats.totalRemitted"),
              value: stats.totalRemitted,
              change: `${remittances?.length ?? 0} transfers`,
              icon: ArrowUpRight,
              trend: "up" as const,
            },
            {
              label: t("stats.yieldApy"),
              value: stats.yieldApy,
              change: "",
              icon: ArrowDownLeft,
              trend: "up" as const,
            },
          ].map((stat, i) => {
            const Icon = stat.icon;
            return (
              <article
                key={i}
                className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="flex items-center justify-between">
                  <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900" aria-hidden="true">
                    <Icon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  {stat.change && (
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        stat.trend === "up"
                          ? "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                          : "bg-zinc-50 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
                      }`}
                      aria-label={`Change: ${stat.change}`}
                    >
                      {stat.change}
                    </span>
                  )}
                </div>
                <div className="mt-4">
                  <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                    <span className="inline-flex items-center gap-1">
                      {stat.label}
                      {stat.label.toLowerCase().includes("apy") ? (
                        <Tooltip
                          content="APY (Annual Percentage Yield): The estimated yearly return on your deposits, including compounding. This may change over time."
                          label="APY info"
                        />
                      ) : null}
                    </span>
                  </p>
                  <h3 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                    {stat.value}
                  </h3>
                </div>
              </article>
            );
          })}
        </section>
      </ErrorBoundary>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <ErrorBoundary scope="recent activity panel" variant="section">
          <section aria-labelledby="activity-heading" className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2
                id="activity-heading"
                className="text-lg font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2"
              >
                <Clock className="h-5 w-5 text-zinc-400" aria-hidden="true" />
                {t("activity.title")}
              </h2>
              <button
                onClick={() => router.push("/activity")}
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 rounded px-2 py-1"
                aria-label="View all recent activity"
              >
                {t("activity.viewAll")}
              </button>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden dark:border-zinc-800 dark:bg-zinc-950">
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {recentActivity.length === 0 ? (
                  <EmptyState
                    icon={Clock}
                    title={t("activity.emptyTitle") || "No activity"}
                    description={t("activity.empty") || "Your recent activity will appear here."}
                  />
                ) : (
                  recentActivity.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className={`h-10 w-10 rounded-full flex items-center justify-center ${
                            item.status === "completed" || item.status === "repaid"
                              ? "bg-green-50 dark:bg-green-500/10"
                              : "bg-indigo-50 dark:bg-indigo-500/10"
                          }`}
                          aria-hidden="true"
                        >
                          {item.amount.startsWith("+") ? (
                            <ArrowDownLeft className="h-5 w-5 text-green-600 dark:text-green-400" />
                          ) : (
                            <ArrowUpRight className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                            {item.type}
                          </p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">{item.desc}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
                          {item.amount}
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">{item.time}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </ErrorBoundary>

        <ErrorBoundary scope="quick actions panel" variant="section">
          <aside aria-labelledby="quick-actions-heading" className="space-y-4">
            <h2
              id="quick-actions-heading"
              className="text-lg font-bold text-zinc-900 dark:text-zinc-50"
            >
              {t("quickActions.title")}
            </h2>
            <div className="space-y-3">
              {[
                {
                  title: t("quickActions.applyLoan"),
                  desc: t("quickActions.applyLoanDesc"),
                  color: "bg-indigo-600",
                  href: "/loans",
                },
                {
                  title: t("quickActions.sendRemittance"),
                  desc: t("quickActions.sendRemittanceDesc"),
                  color: "bg-zinc-900",
                  href: "/send-remittance",
                },
              ].map((action, i) => (
                <button
                  key={i}
                  onClick={() => router.push(action.href)}
                  className={`w-full text-left p-4 rounded-xl ${action.color} text-white hover:opacity-90 transition-opacity shadow-lg shadow-indigo-500/10 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold">{action.title}</span>
                    <ExternalLink className="h-4 w-4 opacity-50" aria-hidden="true" />
                  </div>
                  <p className="text-xs opacity-80">{action.desc}</p>
                </button>
              ))}
            </div>

            {/* Credit Score Gauge */}
            <section
              className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950"
              aria-label={t("creditScore.label")}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {t("creditScore.label")}
                </h3>
                <Tooltip content={t("creditScore.tooltip")} label={t("creditScore.tooltipLabel")} />
              </div>
              <CreditScoreGauge
                score={currentCreditScore ?? 300}
                previousScore={previousCreditScore ?? undefined}
              />
              {!currentCreditScore && (
                <p className="mt-2 text-center text-[10px] text-zinc-400">
                  Join the ecosystem to build your on-chain credit history.
                </p>
              )}
            </section>

            <section
              className="rounded-xl bg-indigo-50 p-6 dark:bg-indigo-950/30 space-y-4"
              aria-labelledby="outreach-heading"
            >
              <h3 id="outreach-heading" className="font-bold text-indigo-900 dark:text-indigo-300">
                {t("outreach.title")}
              </h3>
              <p className="text-sm text-indigo-700 dark:text-indigo-400 leading-relaxed">
                {t("outreach.description")}
              </p>
              <button
                className="text-sm font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 rounded"
                aria-label="Explore micro-loan opportunities"
              >
                {t("outreach.explore")}
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </section>
          </aside>
        </ErrorBoundary>
      </div>
    </main>
  );
}
