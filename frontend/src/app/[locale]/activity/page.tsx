"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Clock, ArrowUpRight, ArrowDownLeft, ExternalLink, X } from "lucide-react";
import { useWalletStore, selectIsWalletConnected } from "../../stores/useWalletStore";
import { useLoans, useRemittances } from "../../hooks/useApi";
import { ErrorBoundary } from "../../components/global_ui/ErrorBoundary";

type FilterType = "all" | "loan" | "remittance";

interface ActivityItem {
  id: string;
  type: "Loan Request" | "Loan Active" | "Loan Repaid" | "Loan Defaulted" | "Remittance";
  description: string;
  amount: string;
  timestamp: string;
  status: "pending" | "active" | "completed" | "repaid" | "failed" | "defaulted" | "processing";
  txHash?: string;
}

const ITEMS_PER_PAGE = 20;

export default function ActivityPage() {
  const t = useTranslations("ActivityPage");
  const isConnected = useWalletStore(selectIsWalletConnected);
  const [currentPage, setCurrentPage] = useState(1);
  const [filterType, setFilterType] = useState<FilterType>("all");

  const { data: loans = [], isLoading: loansLoading } = useLoans({ enabled: isConnected });
  const { data: remittances = [], isLoading: remittancesLoading } = useRemittances({
    enabled: isConnected,
  });

  const isLoading = loansLoading || remittancesLoading;

  const allActivity = useMemo(() => {
    const loanEvents: ActivityItem[] = loans.map((loan, idx) => ({
      id: `loan-${loan.id}`,
      type:
        loan.status === "repaid"
          ? "Loan Repaid"
          : loan.status === "defaulted"
            ? "Loan Defaulted"
            : loan.status === "active"
              ? "Loan Active"
              : "Loan Request",
      description: `Loan #${loan.id} — ${loan.currency}`,
      amount: `${loan.status === "repaid" ? "+" : "-"}${formatCurrency(loan.amount)}`,
      timestamp: new Date(loan.createdAt).toISOString(),
      status: loan.status,
      txHash: undefined,
    }));

    const remittanceEvents: ActivityItem[] = remittances.map((remittance, idx) => ({
      id: `remittance-${remittance.id}`,
      type: "Remittance",
      description: `To ${remittance.recipientAddress.slice(0, 6)}...${remittance.recipientAddress.slice(-4)}`,
      amount: `-${formatCurrency(remittance.amount)}`,
      timestamp: new Date(remittance.createdAt).toISOString(),
      status: remittance.status,
      txHash: undefined,
    }));

    let combined = [...loanEvents, ...remittanceEvents];

    // Apply filters
    if (filterType === "loan") {
      combined = combined.filter((item) => item.type.includes("Loan"));
    } else if (filterType === "remittance") {
      combined = combined.filter((item) => item.type === "Remittance");
    }

    // Sort by timestamp descending
    return combined.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [loans, remittances, filterType]);

  const totalPages = Math.ceil(allActivity.length / ITEMS_PER_PAGE);
  const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedActivity = allActivity.slice(startIdx, startIdx + ITEMS_PER_PAGE);

  if (!isConnected) {
    return (
      <main className="space-y-8 min-h-screen p-8 lg:p-12 max-w-4xl mx-auto animate-in fade-in duration-500">
        <div className="rounded-2xl bg-zinc-50 p-12 text-center dark:bg-zinc-900/50 border border-dashed border-zinc-200 dark:border-zinc-800">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 mb-6">
            <Clock className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
          </div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">{t("notConnected")}</h2>
          <p className="mt-2 text-zinc-500 dark:text-zinc-400">
            {t("connectWalletToViewActivity")}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="space-y-8 min-h-screen p-8 lg:p-12 max-w-4xl mx-auto">
      <header>
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
          <Clock className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
          {t("title")}
        </h1>
        <p className="text-zinc-500 dark:text-zinc-400 mt-2">{t("description")}</p>
      </header>

      <ErrorBoundary scope="activity filters" variant="section">
        <div className="flex flex-wrap gap-3 pb-4 border-b border-zinc-200 dark:border-zinc-800">
          {(["all", "loan", "remittance"] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => {
                setFilterType(filter);
                setCurrentPage(1);
              }}
              className={`px-4 py-2 rounded-full font-medium transition-all ${
                filterType === filter
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/30"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
              aria-pressed={filterType === filter}
            >
              {t(`filters.${filter}`)}
            </button>
          ))}
        </div>
      </ErrorBoundary>

      <ErrorBoundary scope="activity list" variant="section">
        <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden dark:border-zinc-800 dark:bg-zinc-950">
          {isLoading ? (
            <div className="space-y-4 p-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 bg-gradient-to-r from-zinc-100 to-zinc-50 dark:from-zinc-900 dark:to-zinc-800 rounded animate-pulse"
                />
              ))}
            </div>
          ) : paginatedActivity.length === 0 ? (
            <div className="p-12 text-center">
              <Clock className="h-12 w-12 mx-auto text-zinc-300 dark:text-zinc-700 mb-4" />
              <p className="text-zinc-500 dark:text-zinc-400">{t("emptyState")}</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {paginatedActivity.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors"
                >
                  <div className="flex items-center gap-4 flex-1">
                    <div
                      className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                        item.status === "completed" || item.status === "repaid"
                          ? "bg-green-50 dark:bg-green-500/10"
                          : item.status === "failed" || item.status === "defaulted"
                            ? "bg-red-50 dark:bg-red-500/10"
                            : "bg-indigo-50 dark:bg-indigo-500/10"
                      }`}
                      aria-hidden="true"
                    >
                      {item.amount.startsWith("+") ? (
                        <ArrowDownLeft
                          className={`h-5 w-5 ${
                            item.status === "failed" || item.status === "defaulted"
                              ? "text-red-600 dark:text-red-400"
                              : "text-green-600 dark:text-green-400"
                          }`}
                        />
                      ) : (
                        <ArrowUpRight className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                        {item.type}
                      </p>
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                          {item.description}
                        </p>
                        {item.txHash && (
                          <a
                            href={`https://stellar.expert/explorer/public/tx/${item.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                            aria-label={`View transaction ${item.txHash} on Stellar Explorer`}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-4">
                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
                      {item.amount}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {formatDate(item.timestamp)}
                    </p>
                    <span
                      className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(item.status)}`}
                    >
                      {t(`status.${item.status}`)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ErrorBoundary>

      {totalPages > 1 && (
        <ErrorBoundary scope="pagination" variant="section">
          <div className="flex items-center justify-between py-4">
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              {t("pagination.showing", {
                start: startIdx + 1,
                end: Math.min(startIdx + ITEMS_PER_PAGE, allActivity.length),
                total: allActivity.length,
              })}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-4 py-2 rounded-lg bg-zinc-100 text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {t("pagination.previous")}
              </button>
              <div className="flex items-center gap-2">
                {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                  const pageNum = i + 1;
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`w-10 h-10 rounded-lg font-medium transition-all ${
                        currentPage === pageNum
                          ? "bg-indigo-600 text-white"
                          : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      }`}
                      aria-current={currentPage === pageNum ? "page" : undefined}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-4 py-2 rounded-lg bg-zinc-100 text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {t("pagination.next")}
              </button>
            </div>
          </div>
        </ErrorBoundary>
      )}
    </main>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getStatusColor(status: string): string {
  switch (status) {
    case "completed":
    case "repaid":
      return "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400";
    case "pending":
    case "processing":
      return "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400";
    case "failed":
    case "defaulted":
      return "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400";
    case "active":
      return "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400";
    default:
      return "bg-zinc-50 text-zinc-700 dark:bg-zinc-500/10 dark:text-zinc-400";
  }
}
