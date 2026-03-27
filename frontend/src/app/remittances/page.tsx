"use client";

import { useState, useMemo } from "react";
import {
  SendHorizontal,
  Filter,
  Search,
  CheckCircle2,
  Clock,
  XCircle,
  ArrowUpRight,
  TrendingUp,
  Calendar,
  DollarSign,
} from "lucide-react";
import {
  useWalletStore,
  selectIsWalletConnected,
  selectWalletAddress,
} from "../stores/useWalletStore";
import { useRemittances, type Remittance } from "../hooks/useApi";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/Card";
import { ErrorBoundary } from "../components/global_ui/ErrorBoundary";
import { Spinner } from "../components/global_ui/Spinner";
import Link from "next/link";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const STATUS_CONFIG: Record<
  Remittance["status"],
  { label: string; icon: React.ElementType; className: string }
> = {
  completed: {
    label: "Completed",
    icon: CheckCircle2,
    className: "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  },
  pending: {
    label: "Pending",
    icon: Clock,
    className: "bg-yellow-50 text-yellow-700 dark:bg-yellow-500/10 dark:text-yellow-400",
  },
  processing: {
    label: "Processing",
    icon: Clock,
    className: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  },
  failed: {
    label: "Failed",
    icon: XCircle,
    className: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400",
  },
};

type StatusFilter = "all" | Remittance["status"];

// ─── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="rounded-2xl bg-zinc-50 p-6 dark:bg-zinc-900 mb-4">
        <SendHorizontal className="h-10 w-10 text-indigo-400" />
      </div>
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 mb-1">
        {filtered ? "No remittances match your filters" : "No remittances yet"}
      </h3>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-xs">
        {filtered
          ? "Try adjusting your filters to see more results."
          : "Your cross-border transfers will appear here once you send your first remittance."}
      </p>
      {!filtered && (
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
        >
          <ArrowUpRight className="h-4 w-4" />
          Send a Remittance
        </Link>
      )}
    </div>
  );
}

// ─── Connect wallet prompt ─────────────────────────────────────────────────────

function ConnectWalletPrompt() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-8">
      <div className="rounded-2xl bg-zinc-50 p-6 dark:bg-zinc-900">
        <SendHorizontal className="h-12 w-12 text-indigo-600 dark:text-indigo-400" />
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Remittance History</h1>
        <p className="mt-2 max-w-md text-zinc-500 dark:text-zinc-400">
          Connect your wallet to view your cross-border transfer history.
        </p>
      </div>
    </main>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function RemittancesPage() {
  const isConnected = useWalletStore(selectIsWalletConnected);
  const address = useWalletStore(selectWalletAddress);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");

  const [currentTimestamp] = useState(() => Date.now());

  const { data: remittances, isLoading, isError } = useRemittances({ enabled: isConnected });

  const filtered = useMemo(() => {
    if (!remittances) return [];
    return remittances.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (
          !r.recipientAddress.toLowerCase().includes(q) &&
          !r.fromCurrency.toLowerCase().includes(q) &&
          !r.toCurrency.toLowerCase().includes(q)
        )
          return false;
      }
      if (dateFrom && new Date(r.createdAt) < new Date(dateFrom)) return false;
      if (dateTo && new Date(r.createdAt) > new Date(dateTo + "T23:59:59")) return false;
      if (minAmount && r.amount < parseFloat(minAmount)) return false;
      if (maxAmount && r.amount > parseFloat(maxAmount)) return false;
      return true;
    });
  }, [remittances, statusFilter, searchQuery, dateFrom, dateTo, minAmount, maxAmount]);

  const stats = useMemo(() => {
    if (!remittances) return null;
    const completed = remittances.filter((r) => r.status === "completed");
    const totalRemitted = completed.reduce((sum, r) => sum + r.amount, 0);
    const avgAmount = completed.length > 0 ? totalRemitted / completed.length : 0;
    const months =
      completed.length > 0
        ? Math.max(
            1,
            Math.ceil(
              (currentTimestamp -
                new Date(
                  completed[completed.length - 1]?.createdAt ?? currentTimestamp,
                ).getTime()) /
                (1000 * 60 * 60 * 24 * 30),
            ),
          )
        : 1;
    const frequency = completed.length / months;
    return { totalRemitted, avgAmount, count: completed.length, frequency };
  }, [remittances, currentTimestamp]);

  const isFiltered =
    statusFilter !== "all" || !!searchQuery || !!dateFrom || !!dateTo || !!minAmount || !!maxAmount;

  if (!isConnected) return <ConnectWalletPrompt />;

  return (
    <main className="space-y-8 min-h-screen p-8 lg:p-12 max-w-7xl mx-auto">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-indigo-600">
            Transfers
          </p>
          <h1 className="mt-1 text-3xl font-bold text-zinc-900 dark:text-zinc-50">
            Remittance History
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : ""}
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
        >
          <ArrowUpRight className="h-4 w-4" />
          New Remittance
        </Link>
      </header>

      {/* Summary Stats */}
      <ErrorBoundary scope="remittance stats" variant="section">
        <section
          aria-label="Summary Statistics"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {[
            {
              label: "Total Remitted",
              value: stats ? formatCurrency(stats.totalRemitted) : "—",
              icon: DollarSign,
              sub: `${stats?.count ?? 0} completed transfers`,
            },
            {
              label: "Average Amount",
              value: stats ? formatCurrency(stats.avgAmount) : "—",
              icon: TrendingUp,
              sub: "per completed transfer",
            },
            {
              label: "Transfer Frequency",
              value: stats ? `${stats.frequency.toFixed(1)}/mo` : "—",
              icon: Calendar,
              sub: "average per month",
            },
            {
              label: "Credit Score Impact",
              value: stats ? `+${stats.count * 5} pts` : "—",
              icon: ArrowUpRight,
              sub: "from remittance history",
            },
          ].map((s, i) => (
            <article
              key={i}
              className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900 w-fit mb-4">
                <s.icon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{s.label}</p>
              <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mt-1">{s.value}</p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">{s.sub}</p>
            </article>
          ))}
        </section>
      </ErrorBoundary>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search + Status */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <input
                type="text"
                placeholder="Search by recipient or currency..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-white pl-10 pr-4 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>

            <div className="flex gap-2 flex-wrap">
              {(["all", "completed", "pending", "processing", "failed"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    statusFilter === s
                      ? "bg-indigo-600 text-white"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                  }`}
                >
                  {s === "all" ? "All" : STATUS_CONFIG[s].label}
                </button>
              ))}
            </div>
          </div>

          {/* Date + Amount range */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1 block">
                From Date
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1 block">
                To Date
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1 block">
                Min Amount
              </label>
              <input
                type="number"
                placeholder="0.00"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1 block">
                Max Amount
              </label>
              <input
                type="number"
                placeholder="0.00"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>
          </div>

          {isFiltered && (
            <button
              onClick={() => {
                setStatusFilter("all");
                setSearchQuery("");
                setDateFrom("");
                setDateTo("");
                setMinAmount("");
                setMaxAmount("");
              }}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
            >
              Clear all filters
            </button>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      <ErrorBoundary scope="remittances table" variant="section">
        <section aria-label="Remittance history">
          {isLoading ? (
            <div className="flex justify-center py-20">
              <Spinner size="lg" />
            </div>
          ) : isError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center dark:border-red-900/50 dark:bg-red-950/20">
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                Failed to load remittances. Please try again.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState filtered={isFiltered} />
          ) : (
            <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden dark:border-zinc-800 dark:bg-zinc-950">
              {/* Table header */}
              <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
                <span className="col-span-4 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Recipient
                </span>
                <span className="col-span-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Amount
                </span>
                <span className="col-span-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Currency
                </span>
                <span className="col-span-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Date
                </span>
                <span className="col-span-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Status
                </span>
              </div>

              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filtered.map((r) => {
                  const cfg = STATUS_CONFIG[r.status];
                  const Icon = cfg.icon;
                  return (
                    <div
                      key={r.id}
                      className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-zinc-50 dark:hover:bg-zinc-900/30 transition-colors"
                    >
                      <div className="col-span-4 flex items-center gap-3 min-w-0">
                        <div className="h-8 w-8 rounded-full bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
                          <SendHorizontal className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50 truncate font-mono">
                          {r.recipientAddress.slice(0, 8)}...{r.recipientAddress.slice(-6)}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                          {formatCurrency(r.amount)}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-sm text-zinc-500 dark:text-zinc-400">
                          {r.fromCurrency} → {r.toCurrency}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-sm text-zinc-500 dark:text-zinc-400">
                          {formatDate(r.createdAt)}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cfg.className}`}
                        >
                          <Icon className="h-3 w-3" />
                          {cfg.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </ErrorBoundary>

      {/* Footer count */}
      {!isLoading && !isError && filtered.length > 0 && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center">
          Showing {filtered.length} of {remittances?.length ?? 0} remittances
        </p>
      )}
    </main>
  );
}
