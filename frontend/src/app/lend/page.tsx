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
} from "lucide-react";
import { ErrorBoundary } from "../components/global_ui/ErrorBoundary";
import { YieldEarningsChart } from "../components/charts/YieldEarningsChart";
import { useDepositorPortfolio, useLoans, usePoolStats, useYieldHistory } from "../hooks/useApi";
import { LoanStatusBadge } from "../components/ui/LoanStatusBadge";
import { selectWalletAddress, useWalletStore } from "../stores/useWalletStore";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

export default function LendPage() {
  const [depositAmount, setDepositAmount] = useState("100");
  const [withdrawAmount, setWithdrawAmount] = useState("50");
  const address = useWalletStore(selectWalletAddress);

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
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
          Lender Portal
        </p>
        <h1 className="mt-2 text-3xl font-bold text-zinc-900 dark:text-zinc-50">Lend</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
          Track pool performance, manage deposits, and monitor yield growth.
        </p>
      </header>

      <ErrorBoundary scope="lender overview" variant="section">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: "Total Pool Size",
              value: isLoading ? "--" : formatCurrency(poolStats?.totalDeposits ?? 0),
              icon: CircleDollarSign,
            },
            {
              label: "Utilization Rate",
              value: isLoading ? "--" : formatPercent(poolStats?.utilizationRate ?? 0),
              icon: Percent,
            },
            {
              label: "Current APY",
              value: isLoading ? "--" : formatPercent(poolStats?.apy ?? 0),
              icon: Activity,
            },
            {
              label: "Active Loans",
              value: isLoading ? "--" : String(poolStats?.activeLoansCount ?? 0),
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
                  <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {item.value}
                  </p>
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
                <p className="mt-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  {isLoading ? "--" : formatCurrency(depositor?.depositAmount ?? 0)}
                </p>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Share of Pool</p>
                <p className="mt-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  {isLoading ? "--" : formatPercent(depositor?.sharePercent ?? 0)}
                </p>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Estimated Earnings</p>
                <p className="mt-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  {isLoading ? "--" : formatCurrency(depositor?.estimatedYield ?? 0)}
                </p>
              </div>
            </div>
          </article>

          <article className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Deposit / Withdraw
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <form className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
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
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
                >
                  <ArrowUpRight className="h-4 w-4" />
                  Deposit
                </button>
              </form>

              <form className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
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
                  type="button"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                >
                  <ArrowDownLeft className="h-4 w-4" />
                  Withdraw
                </button>
              </form>
            </div>
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              Contract integration can be wired into these form actions.
            </p>
          </article>
        </section>
      </ErrorBoundary>

      <ErrorBoundary scope="loan portfolio" variant="section">
        <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Loan Portfolio</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Read-only view of loans currently funded through the pool.
          </p>

          <div className="mt-4 space-y-3">
            {(loans ?? [])
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
                    href={`/loans/${loan.id}`}
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
          <YieldEarningsChart data={chartData} />
        </section>
      </ErrorBoundary>
    </main>
  );
}
