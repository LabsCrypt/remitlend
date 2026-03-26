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
import {
  useWalletStore,
  selectIsWalletConnected,
  selectWalletAddress,
} from "./stores/useWalletStore";
import { useLoans, useRemittances, useUserBalance } from "./hooks/useApi";
import { DashboardSkeleton } from "./components/skeletons/DashboardSkeleton";
import { CreditScoreGauge } from "./components/ui/CreditScoreGauge";
import { ErrorBoundary } from "./components/global_ui/ErrorBoundary";
import { useMemo } from "react";

function ConnectWalletPrompt() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-8">
      <div className="rounded-2xl bg-zinc-50 p-6 dark:bg-zinc-900">
        <WalletCards className="h-12 w-12 text-indigo-600 dark:text-indigo-400" />
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Welcome to RemitLend</h1>
        <p className="mt-2 max-w-md text-zinc-500 dark:text-zinc-400">
          Connect your wallet to view your portfolio, active loans, and recent activity.
        </p>
      </div>
    </main>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export default function Home() {
  const isConnected = useWalletStore(selectIsWalletConnected);
  const address = useWalletStore(selectWalletAddress);

  const { data: loans, isLoading: loansLoading } = useLoans({ enabled: isConnected });
  const { data: remittances, isLoading: remittancesLoading } = useRemittances({
    enabled: isConnected,
  });
  const { data: balance, isLoading: balanceLoading } = useUserBalance({ enabled: isConnected });

  const isLoading = loansLoading || remittancesLoading || balanceLoading;

  const stats = useMemo(() => {
    const activeLoans = loans?.filter((l) => l.status === "active") ?? [];
    const activeCount = activeLoans.length;
    const pendingCount = loans?.filter((l) => l.status === "pending").length ?? 0;

    const totalRemitted =
      remittances?.filter((r) => r.status === "completed").reduce((sum, r) => sum + r.amount, 0) ??
      0;

    const netWorth = (balance?.available ?? 0) + (balance?.locked ?? 0);

    // Calculate simple APY from active loans
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
  }, [loans, remittances, balance]);

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
    return <ConnectWalletPrompt />;
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
      {/* Welcome Section */}
      <header>
        <h1 id="dashboard-title" className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          Welcome, {shortAddress}
        </h1>
        <p className="text-zinc-500 dark:text-zinc-400">
          Here is what&apos;s happening with your portfolio today.
        </p>
      </header>

      {/* Stats Grid */}
      <ErrorBoundary scope="dashboard summary" variant="section">
        <section
          aria-label="Portfolio Statistics"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {[
            {
              label: "Net Worth",
              value: stats.netWorth,
              change: balance ? `${formatCurrency(balance.available)} available` : "",
              icon: Activity,
              trend: "up" as const,
            },
            {
              label: "Active Loans",
              value: stats.activeLoans,
              change: stats.activeLoansSub,
              icon: Users,
              trend: "neutral" as const,
            },
            {
              label: "Total Remitted",
              value: stats.totalRemitted,
              change: `${remittances?.length ?? 0} transfers`,
              icon: ArrowUpRight,
              trend: "up" as const,
            },
            {
              label: "Yield (APY)",
              value: stats.yieldApy,
              change: "",
              icon: ArrowDownLeft,
              trend: "up" as const,
            },
          ].map((stat, i) => (
            <article
              key={i}
              className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="flex items-center justify-between">
                <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900" aria-hidden="true">
                  <stat.icon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
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
                <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{stat.label}</p>
                <h3 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{stat.value}</h3>
              </div>
            </article>
          ))}
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
                Recent Activity
              </h2>
              <button
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 rounded px-2 py-1"
                aria-label="View all recent activity"
              >
                View All
              </button>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden dark:border-zinc-800 dark:bg-zinc-950">
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {recentActivity.length === 0 ? (
                  <div className="p-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                    No recent activity yet. Your transactions will appear here.
                  </div>
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
              Quick Actions
            </h2>
            <div className="space-y-3">
              {[
                { title: "Apply for Loan", desc: "Get instant liquidity", color: "bg-indigo-600" },
                { title: "Send Remittance", desc: "Transfer funds globally", color: "bg-zinc-900" },
              ].map((action, i) => (
                <button
                  key={i}
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
              aria-label="Credit Score"
            >
              <CreditScoreGauge score={720} previousScore={705} />
            </section>

            <section
              className="rounded-xl bg-indigo-50 p-6 dark:bg-indigo-950/30 space-y-4"
              aria-labelledby="outreach-heading"
            >
              <h3 id="outreach-heading" className="font-bold text-indigo-900 dark:text-indigo-300">
                Community Outreach
              </h3>
              <p className="text-sm text-indigo-700 dark:text-indigo-400 leading-relaxed">
                New borrowers in Ghana are looking for micro-loans for agricultural tools. Help grow
                the ecosystem!
              </p>
              <button
                className="text-sm font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 rounded"
                aria-label="Explore micro-loan opportunities"
              >
                Explore Opportunities
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </section>
          </aside>
        </ErrorBoundary>
      </div>
    </main>
  );
}
