import type { Metadata } from "next";
import { buildPageMetadata } from "../../lib/metadata";

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;

  return buildPageMetadata({
    locale,
    path: "/liquidations",
    title: "Liquidations | RemitLend",
    description:
      "Monitor and manage collateral liquidations for undercollateralized loans to protect pool health.",
  });
}

("use client");

import { useState } from "react";
import { AlertTriangle, RefreshCw, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  buildLiquidateLoanTransaction,
  queryKeys,
  submitLoanTransaction,
  useLiquidatableLoans,
  type LiquidatableLoan,
} from "../../hooks/useApi";
import { useWallet } from "../../components/providers/WalletProvider";
import { Skeleton } from "../../components/ui/Skeleton";
import { EmptyState } from "../../components/ui/EmptyState";
import { useContractToast } from "../../hooks/useContractToast";
import { selectWalletAddress, useWalletStore } from "../../stores/useWalletStore";
import { useQueryClient } from "@tanstack/react-query";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatRatio(value: number) {
  return value > 10 ? `${value.toFixed(2)}%` : `${(value * 100).toFixed(2)}%`;
}

function LiquidationsSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="grid gap-4 border-b border-zinc-100 p-4 last:border-b-0 dark:border-zinc-800 md:grid-cols-5"
        >
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-9 w-28 justify-self-end rounded-lg" />
        </div>
      ))}
    </div>
  );
}

function LiquidationsTable({
  loans,
  onLiquidate,
  pendingLoanId,
}: {
  loans: LiquidatableLoan[];
  onLiquidate: (loan: LiquidatableLoan) => void;
  pendingLoanId: number | null;
}) {
  const t = useTranslations("Liquidations");

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3">{t("table.loan")}</th>
              <th className="px-4 py-3">{t("table.borrower")}</th>
              <th className="px-4 py-3">{t("table.collateral")}</th>
              <th className="px-4 py-3">{t("table.debt")}</th>
              <th className="px-4 py-3">{t("table.health")}</th>
              <th className="px-4 py-3 text-right">{t("table.action")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {loans.map((loan) => (
              <tr key={loan.loanId} className="align-middle">
                <td className="px-4 py-4 font-semibold text-zinc-900 dark:text-zinc-50">
                  #{loan.loanId}
                </td>
                <td className="max-w-56 px-4 py-4 font-mono text-xs text-zinc-600 dark:text-zinc-300">
                  <span className="block truncate" title={loan.borrower}>
                    {loan.borrower || t("unknownBorrower")}
                  </span>
                </td>
                <td className="px-4 py-4 text-zinc-600 dark:text-zinc-300">
                  {formatCurrency(loan.collateral)}
                </td>
                <td className="px-4 py-4 text-zinc-600 dark:text-zinc-300">
                  {formatCurrency(loan.totalDebt)}
                </td>
                <td className="px-4 py-4">
                  <span className="inline-flex items-center gap-2 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                    {formatRatio(loan.healthFactor || loan.collateralRatio)}
                  </span>
                </td>
                <td className="px-4 py-4 text-right">
                  <button
                    type="button"
                    onClick={() => onLiquidate(loan)}
                    disabled={pendingLoanId === loan.loanId}
                    className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                    {pendingLoanId === loan.loanId ? t("liquidating") : t("liquidate")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function LiquidationsPage() {
  const t = useTranslations("Liquidations");
  const address = useWalletStore(selectWalletAddress);
  const { signTransaction } = useWallet();
  const toast = useContractToast();
  const queryClient = useQueryClient();
  const [pendingLoanId, setPendingLoanId] = useState<number | null>(null);
  const liquidatableQuery = useLiquidatableLoans();

  async function handleLiquidate(loan: LiquidatableLoan) {
    if (!address) {
      toast.error(t("walletRequired.title"), t("walletRequired.description"));
      return;
    }

    const toastId = toast.showPending(t("pending"));
    setPendingLoanId(loan.loanId);

    try {
      const built = await buildLiquidateLoanTransaction({
        loanId: loan.loanId,
        liquidatorPublicKey: address,
      });
      const signedTxXdr = await signTransaction(built.unsignedTxXdr);
      const submitted = await submitLoanTransaction(signedTxXdr);

      toast.showSuccess(toastId, {
        txHash: submitted.txHash,
        successMessage: t("success"),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.loans.liquidatable() });
    } catch (error) {
      toast.showError(toastId, {
        errorMessage: error instanceof Error ? error.message : t("error.description"),
        retryAction: () => handleLiquidate(loan),
      });
    } finally {
      setPendingLoanId(null);
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-red-600">
            {t("eyebrow")}
          </p>
          <h1 className="mt-2 text-3xl font-bold text-zinc-900 dark:text-zinc-50">{t("title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            {t("description")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => liquidatableQuery.refetch()}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {t("refresh")}
        </button>
      </header>

      {liquidatableQuery.isLoading ? (
        <LiquidationsSkeleton />
      ) : liquidatableQuery.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title={t("error.title")}
          description={t("error.description")}
        />
      ) : (liquidatableQuery.data ?? []).length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <LiquidationsTable
          loans={liquidatableQuery.data ?? []}
          onLiquidate={handleLiquidate}
          pendingLoanId={pendingLoanId}
        />
      )}
    </section>
  );
}
