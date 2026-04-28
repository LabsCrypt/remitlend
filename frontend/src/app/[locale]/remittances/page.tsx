"use client";

import { useMemo, useState } from "react";
import {
  SendHorizontal,
  Filter,
  CheckCircle2,
  Clock,
  XCircle,
  ArrowUpRight,
  TrendingUp,
  Calendar,
  DollarSign,
  Search,
} from "lucide-react";
import { useLocale } from "next-intl";
import {
  useWalletStore,
  selectIsWalletConnected,
  selectWalletAddress,
} from "../../stores/useWalletStore";
import { useRemittancesPage, type Remittance } from "../../hooks/useApi";
import { Card, CardHeader, CardTitle, CardContent } from "../../components/ui/Card";
import { ErrorBoundary } from "../../components/global_ui/ErrorBoundary";
import { Spinner } from "../../components/global_ui/Spinner";
import { PaginationControls } from "../../components/ui/PaginationControls";
import Link from "next/link";
import { EmptyState } from "../../components/ui/EmptyState";

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

const PAGE_SIZE = 20;

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

export default function RemittancesPage() {
  const locale = useLocale();
  const isConnected = useWalletStore(selectIsWalletConnected);
  const address = useWalletStore(selectWalletAddress);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [pageCursors, setPageCursors] = useState<Record<number, string | null>>({ 1: null });
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");

  const statusParam = statusFilter === "all" ? undefined : statusFilter;
  const {
    data: remittancesPage,
    isLoading,
    isError,
  } = useRemittancesPage(
    {
      limit: PAGE_SIZE,
      cursor: pageCursors[page] ?? null,
      status: statusParam,
    },
    { enabled: isConnected },
  );

  const remittances = remittancesPage?.items ?? [];
  const totalPages = Math.max(
    page,
    remittancesPage?.pageInfo.hasNext
      ? Object.keys(pageCursors).length + 1
      : Object.keys(pageCursors).length,
  );

  const stats = useMemo(() => {
    if (remittances.length === 0) {
      return null;
    }

    const completed = remittances.filter((remittance) => remittance.status === "completed");
    const totalRemitted = completed.reduce((sum, remittance) => sum + remittance.amount, 0);
    const avgAmount = completed.length > 0 ? totalRemitted / completed.length : 0;
    const referenceDate = new Date();
    const nowMs = referenceDate.getTime();
    const lastCompletedDate =
      completed.length > 0 ? new Date(completed[completed.length - 1].createdAt).getTime() : nowMs;
    const months =
      completed.length > 0
        ? Math.max(1, Math.ceil((nowMs - lastCompletedDate) / (1000 * 60 * 60 * 24 * 30)))
        : 1;

    return {
      totalRemitted,
      avgAmount,
      count: completed.length,
      frequency: completed.length / months,
    };
  }, [remittances]);

  if (!isConnected) {
    return <ConnectWalletPrompt />;
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl space-y-8 p-8 lg:p-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
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
          href={`/${locale}/send-remittance`}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
        >
          <ArrowUpRight className="h-4 w-4" />
          New Remittance
        </Link>
      </header>

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
              sub: `${stats?.count ?? 0} completed transfers on this page`,
            },
            {
              label: "Average Amount",
              value: stats ? formatCurrency(stats.avgAmount) : "—",
              icon: TrendingUp,
              sub: "per completed transfer on this page",
            },
            {
              label: "Transfer Frequency",
              value: stats ? `${stats.frequency.toFixed(1)}/mo` : "—",
              icon: Calendar,
              sub: "average per month on this page",
            },
            {
              label: "Credit Score Impact",
              value: stats ? `+${stats.count * 5} pts` : "—",
              icon: ArrowUpRight,
              sub: "from visible remittance history",
            },
          ].map((item) => (
            <article
              key={item.label}
              className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="mb-4 w-fit rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900">
                <item.icon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{item.label}</p>
              <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                {item.value}
              </p>
              <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{item.sub}</p>
            </article>
          ))}
        </section>
      </ErrorBoundary>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4" />
            Status
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
                  aria-pressed={statusFilter === s}
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
        </CardContent>
      </Card>

      <ErrorBoundary scope="remittances table" variant="section">
        <section aria-label="Remittance history">
          {isLoading ? (
            <div className="flex justify-center py-20">
              <Spinner type="spin" size={32} />
            </div>
          ) : isError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center dark:border-red-900/50 dark:bg-red-950/20">
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                Failed to load remittances. Please try again.
              </p>
            </div>
          ) : remittances.length === 0 ? (
            <EmptyState
              icon={SendHorizontal}
              title={
                statusFilter !== "all" ? "No remittances match this status" : "No remittances yet"
              }
              description={
                statusFilter !== "all"
                  ? "Try a different filter to see more transfer history."
                  : "Your cross-border transfers will appear here once you send your first remittance."
              }
              actionLabel={statusFilter !== "all" ? undefined : "Send your first remittance"}
              actionHref={statusFilter !== "all" ? undefined : `/${locale}/send-remittance`}
              actionIcon={<ArrowUpRight className="h-4 w-4" />}
            />
          ) : (
            <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden dark:border-zinc-800 dark:bg-zinc-950">
              <div className="grid grid-cols-12 gap-4 border-b border-zinc-100 bg-zinc-50 px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
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
                {remittances.map((remittance) => {
                  const config = STATUS_CONFIG[remittance.status];
                  const Icon = config.icon;

                  return (
                    <div
                      key={remittance.id}
                      className="grid grid-cols-12 items-center gap-4 px-6 py-4 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/30"
                    >
                      <div className="col-span-4 flex min-w-0 items-center gap-3">
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/10">
                          <SendHorizontal className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <span className="truncate font-mono text-sm font-medium text-zinc-900 dark:text-zinc-50">
                          {remittance.recipientAddress.slice(0, 8)}...
                          {remittance.recipientAddress.slice(-6)}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                          {formatCurrency(remittance.amount)}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-sm text-zinc-500 dark:text-zinc-400">
                          {remittance.fromCurrency} → {remittance.toCurrency}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-sm text-zinc-500 dark:text-zinc-400">
                          {formatDate(remittance.createdAt)}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${config.className}`}
                        >
                          <Icon className="h-3 w-3" />
                          {config.label}
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

      {!isLoading && !isError && remittances.length > 0 && (
        <PaginationControls
          currentPage={page}
          totalPages={totalPages}
          hasPrevious={page > 1}
          hasNext={Boolean(remittancesPage?.pageInfo.hasNext)}
          onPageChange={(nextPage) => {
            if (pageCursors[nextPage] !== undefined) {
              setPage(nextPage);
              return;
            }

            if (nextPage === page + 1 && remittancesPage?.pageInfo.nextCursor) {
              setPageCursors((current) => ({
                ...current,
                [nextPage]: remittancesPage.pageInfo.nextCursor,
              }));
              setPage(nextPage);
            }
          }}
          onPrevious={() => setPage((previous) => Math.max(1, previous - 1))}
          onNext={() => {
            if (remittancesPage?.pageInfo.nextCursor) {
              setPageCursors((current) => ({
                ...current,
                [page + 1]: remittancesPage.pageInfo.nextCursor,
              }));
              setPage(page + 1);
            }
          }}
          summary={`Showing ${remittances.length} remittances on page ${page}`}
        />
      )}
    </main>
  );
}
