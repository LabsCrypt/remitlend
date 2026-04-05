"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  CircleDollarSign,
  HandCoins,
  Percent,
  PiggyBank,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useLocale } from "next-intl";
import { ErrorBoundary } from "../../components/global_ui/ErrorBoundary";
import { Skeleton } from "../../components/ui/Skeleton";
import { YieldEarningsChart } from "../../components/charts/YieldEarningsChart";
import {
  useDepositorPortfolio,
  useInvalidatePoolStats,
  useLoans,
  usePoolStats,
  useYieldHistory,
} from "../../hooks/useApi";
import { LoanStatusBadge } from "../../components/ui/LoanStatusBadge";
import { DepositWithdrawSkeleton } from "../../components/skeletons/DepositWithdrawSkeleton";
import { OperationProgress } from "../../components/ui/OperationProgress";
import { useDepositOperation, useWithdrawalOperation } from "../../hooks/useRepaymentOperation";
import { selectWalletAddress, useWalletStore } from "../../stores/useWalletStore";
import { useSSE } from "../../hooks/useSSE";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

export function LendPageClient() {
  const locale = useLocale();
  const [depositAmount, setDepositAmount] = useState("100");
  const [withdrawAmount, setWithdrawAmount] = useState("50");
  const address = useWalletStore(selectWalletAddress);

  const depositOp = useDepositOperation();
  const withdrawalOp = useWithdrawalOperation();

  const invalidatePoolStats = useInvalidatePoolStats();
  const sseUrl = address ? `${API_URL}/pool/events` : null;
  const sseStatus = useSSE<{ type: string }>({
    url: sseUrl,
    onMessage: (data) => {
      if (data?.type === "pool_updated") {
        invalidatePoolStats();
      }
    },
  });

  const handleDeposit = async () => {
    const amount = parseFloat(depositAmount);
    if (!address || isNaN(amount) || amount <= 0) return;
    await depositOp.executeDeposit({ amount, depositorAddress: address });
  };

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    if (!address || isNaN(amount) || amount <= 0) return;
    await withdrawalOp.executeWithdrawal({ amount, depositorAddress: address });
  };

  const {
    data: poolStats,
    isLoading: poolLoading,
    isError: poolError,
  } = usePoolStats({ enabled: !!address });
  const {
    data: depositor,
    isLoading: depositorLoading,
    isError: depositorError,
  } = useDepositorPortfolio(address ?? undefined, { enabled: !!address });
  const {
    data: loans,
    isLoading: loansLoading,
    isError: loansError,
  } = useLoans({ enabled: !!address });
  const {
    data: yieldHistory,
    isLoading: historyLoading,
    isError: historyError,
  } = useYieldHistory(address ?? undefined, { enabled: !!address });

  const chartData = useMemo(
    () =>
      (yieldHistory ?? []).map((entry) => ({
        date: new Date(entry.date).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        earnings: entry.earnings,
        apy: entry.apy,
        principal: entry.principal,
      })),
    [yieldHistory],
  );

  if (!address) {
    return (
      <section className="rounded-3xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Lender Dashboard</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Connect your wallet to view your lending pool portfolio.
        </p>
      </section>
    );
  }

  if (poolError || depositorError || loansError || historyError) {
    return (
      <section className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
        Failed to load lender dashboard data. Please try again.
      </section>
    );
  }

  const isLoading = poolLoading || depositorLoading || loansLoading || historyLoading;

  return (
    <main className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
            Lender Portal
          </p>
          <h1 className="mt-2 text-3xl font-bold text-zinc-900 dark:text-zinc-50">Lend</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            Track pool performance, manage deposits, and monitor yield growth.
          </p>
        </div>
        {address && (
          <div
            className={`mt-1 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
              sseStatus === "connected"
                ? "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                : sseStatus === "connecting"
                  ? "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                  : "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
            }`}
            title={
              sseStatus === "connected"
                ? "Live pool updates connected"
                : sseStatus === "connecting"
                  ? "Connecting to live updates…"
                  : "Live updates disconnected — retrying"
            }
          >
            {sseStatus === "connected" ? (
              <Wifi className="h-3.5 w-3.5" />
            ) : (
              <WifiOff className="h-3.5 w-3.5" />
            )}
            {sseStatus === "connected"
              ? "Live"
              : sseStatus === "connecting"
                ? "Connecting…"
                : "Offline"}
          </div>
        )}
      </header>

      <ErrorBoundary scope="lender overview" variant="section">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: "Total Pool Size",
              value: formatCurrency(poolStats?.totalDeposits ?? 0),
              icon: CircleDollarSign,
            },
            {
              label: "Utilization Rate",
              value: formatPercent(poolStats?.utilizationRate ?? 0),
              icon: Percent,
            },
            {
              label: "Current APY",
              value: formatPercent(poolStats?.apy ?? 0),
              icon: Activity,
            },
            {
              label: "Active Loans",
              value: String(poolStats?.activeLoansCount ?? 0),
              icon: HandCoins,
            },
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
                  {isLoading ? (
                    <Skeleton className="mt-1 h-7 w-24" />
                  ) : (
                    <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                      {item.value}
                    </p>
                  )}
                </div>
              </div>
            </article>
          ))}
        </section>
      </ErrorBoundary>

      <ErrorBoundary scope="depositor summary" variant="section">
        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <article className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">My Deposits</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Deposited Amount</p>
                {isLoading ? (
                  <Skeleton className="mt-2 h-7 w-24" />
                ) : (
                  <p className="mt-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {formatCurrency(depositor?.depositAmount ?? 0)}
                  </p>
                )}
              </div>
              <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Share of Pool</p>
                {isLoading ? (
                  <Skeleton className="mt-2 h-7 w-24" />
                ) : (
                  <p className="mt-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {formatPercent(depositor?.sharePercent ?? 0)}
                  </p>
                )}
              </div>
              <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Estimated Earnings</p>
                {isLoading ? (
                  <Skeleton className="mt-2 h-7 w-24" />
                ) : (
                  <p className="mt-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {formatCurrency(depositor?.estimatedYield ?? 0)}
                  </p>
                )}
              </div>
            </div>
          </article>
          {isLoading ? (
            <DepositWithdrawSkeleton />
          ) : (
            <article className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                Deposit / Withdraw
              </h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <form
                  className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleDeposit();
                  }}
                >
                  <label
                    htmlFor="deposit-amount"
                    className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Deposit Amount
                  </label>
                  <input
                    id="deposit-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={depositAmount}
                    onChange={(event) => setDepositAmount(event.target.value)}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-800 dark:bg-zinc-900"
                  />
                  <button
                    type="submit"
                    disabled={depositOp.isLoading}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <ArrowUpRight className="h-4 w-4" />
                    {depositOp.isLoading ? "Depositing..." : "Deposit"}
                  </button>
                  <OperationProgress transaction={depositOp.transaction} type="deposit" />
                </form>

                <form
                  className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleWithdraw();
                  }}
                >
                  <label
                    htmlFor="withdraw-amount"
                    className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Withdraw Amount
                  </label>
                  <input
                    id="withdraw-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={withdrawAmount}
                    onChange={(event) => setWithdrawAmount(event.target.value)}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-800 dark:bg-zinc-900"
                  />
                  <button
                    type="submit"
                    disabled={withdrawalOp.isLoading}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    <ArrowDownLeft className="h-4 w-4" />
                    {withdrawalOp.isLoading ? "Withdrawing..." : "Withdraw"}
                  </button>
                  <OperationProgress transaction={withdrawalOp.transaction} type="withdrawal" />
                </form>
              </div>
            </article>
          )}
        </section>
      </ErrorBoundary>

      <ErrorBoundary scope="loan portfolio" variant="section">
        <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Loan Portfolio</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Read-only view of loans currently funded through the pool.
          </p>

          <div className="mt-4 space-y-3">
            {isLoading && (
              <>
                <Skeleton className="h-[76px] w-full rounded-2xl" />
                <Skeleton className="h-[76px] w-full rounded-2xl" />
                <Skeleton className="h-[76px] w-full rounded-2xl" />
              </>
            )}
            {!isLoading &&
              (loans ?? [])
                .filter((loan) => loan.status === "active")
                .slice(0, 8)
                .map((loan) => (
                  <article
                    key={loan.id}
                    className="flex flex-col gap-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                        Loan #{loan.id}
                      </p>
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        Borrower: {loan.borrowerId}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
                      <span>{formatCurrency(loan.amount)}</span>
                      <span>{loan.interestRate.toFixed(2)}% APR</span>
                      <span>{loan.termDays} days</span>
                      <LoanStatusBadge status={loan.status} />
                    </div>
                    <Link
                      href={`/${locale}/loans/${loan.id}`}
                      className="inline-flex items-center gap-2 rounded-full border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                    >
                      View
                    </Link>
                  </article>
                ))}

            {!isLoading &&
              (loans ?? []).filter((loan) => loan.status === "active").length === 0 && (
                <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-8 text-center dark:border-zinc-700">
                  <PiggyBank className="mx-auto h-6 w-6 text-zinc-400" />
                  <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                    No active pool-funded loans available yet.
                  </p>
                </div>
              )}
          </div>
        </section>
      </ErrorBoundary>

      <ErrorBoundary scope="yield history" variant="section">
        <section className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
          {isLoading ? (
            <div className="space-y-4 p-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-[300px] w-full rounded-xl" />
            </div>
          ) : (
            <YieldEarningsChart data={chartData} />
          )}
        </section>
      </ErrorBoundary>
    </main>
  );
}
