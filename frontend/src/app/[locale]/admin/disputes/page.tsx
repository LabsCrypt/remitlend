"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, ArrowRight, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys, useAdminDisputes, type AdminDispute } from "../../../hooks/useApi";
import { useSSE } from "../../../hooks/useSSE";
import { useUserStore } from "../../../stores/useUserStore";
import { useAdminGuard } from "../../../hooks/useAdminGuard";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

function summarize(reason: string) {
  return reason.length > 120 ? `${reason.slice(0, 117)}...` : reason;
}

function formatDate(value: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-zinc-300 px-6 py-12 text-center dark:border-zinc-700">
      <AlertTriangle className="h-8 w-8 text-zinc-400" aria-hidden="true" />
      <div>
        <p className="font-semibold text-zinc-900 dark:text-zinc-50">{title}</p>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
      </div>
    </div>
  );
}

function DisputesTable({ disputes }: { disputes: AdminDispute[] }) {
  const t = useTranslations("AdminDisputes");
  const locale = useLocale();

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
          <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3">{t("table.borrower")}</th>
              <th className="px-4 py-3">{t("table.loanId")}</th>
              <th className="px-4 py-3">{t("table.reason")}</th>
              <th className="px-4 py-3">{t("table.submitted")}</th>
              <th className="px-4 py-3 text-right">{t("table.action")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {disputes.map((dispute) => (
              <tr key={dispute.id} className="align-top">
                <td className="max-w-56 px-4 py-4 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                  <span className="block truncate" title={dispute.borrower}>
                    {dispute.borrower}
                  </span>
                </td>
                <td className="px-4 py-4 font-medium text-zinc-900 dark:text-zinc-50">
                  #{dispute.loanId}
                </td>
                <td className="max-w-md px-4 py-4 text-zinc-600 dark:text-zinc-300">
                  {summarize(dispute.reason)}
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-zinc-500 dark:text-zinc-400">
                  {formatDate(dispute.submittedAt ?? dispute.createdAt)}
                </td>
                <td className="px-4 py-4 text-right">
                  <Link
                    href={`/${locale}/admin/disputes/${dispute.id}`}
                    className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                  >
                    {t("review")}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminDisputesPage() {
  const t = useTranslations("AdminDisputes");
  const queryClient = useQueryClient();
  const { isAdmin, isChecking } = useAdminGuard();
  const disputesQuery = useAdminDisputes({ enabled: isAdmin });

  useSSE<{ eventType?: string; type?: string }>({
    url: isAdmin ? `${API_URL}/api/events/stream` : null,
    onMessage: (event) => {
      const eventType = event.eventType ?? event.type ?? "";
      if (/dispute|default/i.test(eventType)) {
        queryClient.invalidateQueries({ queryKey: queryKeys.adminDisputes.all() });
      }
    },
  });

  if (isChecking || !isAdmin) {
    return <div className="text-sm text-zinc-500 dark:text-zinc-400">{t("checkingAccess")}</div>;
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
            {t("eyebrow")}
          </p>
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">{t("title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            {t("description")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => disputesQuery.refetch()}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {t("refresh")}
        </button>
      </header>

      {disputesQuery.isLoading ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          {t("loading")}
        </div>
      ) : disputesQuery.isError ? (
        <EmptyState title={t("error.title")} description={t("error.description")} />
      ) : (disputesQuery.data ?? []).length === 0 ? (
        <EmptyState title={t("empty.title")} description={t("empty.description")} />
      ) : (
        <DisputesTable disputes={disputesQuery.data ?? []} />
      )}
    </section>
  );
}
