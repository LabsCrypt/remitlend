"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, ExternalLink } from "lucide-react";
import {
  useAdminDispute,
  useResolveAdminDispute,
  type AdminDispute,
} from "../../../../hooks/useApi";
import { useAdminGuard } from "../../../../hooks/useAdminGuard";
import { Modal } from "../../../../components/ui/Modal";

type ResolutionAction = "resolve" | "reject";

function formatDate(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatAmount(value?: number) {
  if (value === undefined) return "-";
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 7,
  }).format(value);
}

function LoanSummary({ dispute }: { dispute: AdminDispute }) {
  const t = useTranslations("AdminDisputes.detail.loan");
  const locale = useLocale();
  const loan = dispute.loan;

  const rows = [
    [t("principal"), formatAmount(loan?.principal)],
    [t("totalOwed"), formatAmount(loan?.totalOwed)],
    [t("totalRepaid"), formatAmount(loan?.totalRepaid)],
    [t("status"), loan?.status ?? dispute.status],
    [t("nextPayment"), formatDate(loan?.nextPaymentDeadline)],
  ];

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{t("title")}</h2>
        <Link
          href={`/${locale}/loans/${dispute.loanId}`}
          className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-500"
        >
          {t("openLoan")}
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900">
            <dt className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {label}
            </dt>
            <dd className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function AdminDisputeDetailPage() {
  const t = useTranslations("AdminDisputes.detail");
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const locale = useLocale();
  const { isAdmin, isChecking } = useAdminGuard();
  const disputeQuery = useAdminDispute(params?.id, { enabled: isAdmin && Boolean(params?.id) });
  const resolveDispute = useResolveAdminDispute();
  const [note, setNote] = useState("");
  const [pendingAction, setPendingAction] = useState<ResolutionAction | null>(null);

  const noteIsValid = note.trim().length >= 5;
  const dispute = disputeQuery.data;
  const modalCopy = useMemo(() => {
    if (pendingAction === "resolve") {
      return {
        title: t("modal.confirmTitle"),
        description: t("modal.confirmDescription"),
      };
    }
    return {
      title: t("modal.reverseTitle"),
      description: t("modal.reverseDescription"),
    };
  }, [pendingAction, t]);

  async function submitResolution() {
    if (!pendingAction || !params?.id || !noteIsValid) return;
    await resolveDispute.mutateAsync({
      id: params.id,
      action: pendingAction,
      note: note.trim(),
    });
    setPendingAction(null);
    router.push(`/${locale}/admin/disputes`);
  }

  if (isChecking || !isAdmin) {
    return <div className="text-sm text-zinc-500 dark:text-zinc-400">{t("loading")}</div>;
  }

  if (disputeQuery.isLoading) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        {t("loading")}
      </div>
    );
  }

  if (disputeQuery.isError || !dispute) {
    return (
      <section className="space-y-4">
        <Link
          href={`/${locale}/admin/disputes`}
          className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-500"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("back")}
        </Link>
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          {t("error")}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <Link
        href={`/${locale}/admin/disputes`}
        className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-600 hover:text-indigo-500"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("back")}
      </Link>

      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
          {t("title", { id: dispute.id })}
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("submitted", {
            borrower: dispute.borrower,
            date: formatDate(dispute.submittedAt ?? dispute.createdAt),
          })}
        </p>
      </header>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{t("reason")}</h2>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-700 dark:text-zinc-300">
          {dispute.reason}
        </p>
      </section>

      <LoanSummary dispute={dispute} />

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <label
          htmlFor="resolution-note"
          className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
        >
          {t("noteLabel")}
        </label>
        <textarea
          id="resolution-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={t("notePlaceholder")}
          className="mt-2 min-h-32 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:ring-indigo-950"
        />
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{t("noteHelp")}</p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            disabled={!noteIsValid}
            onClick={() => setPendingAction("resolve")}
            className="inline-flex justify-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {t("confirmDefault")}
          </button>
          <button
            type="button"
            disabled={!noteIsValid}
            onClick={() => setPendingAction("reject")}
            className="inline-flex justify-center rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            {t("reverseDefault")}
          </button>
        </div>
      </section>

      <Modal
        isOpen={Boolean(pendingAction)}
        onClose={() => setPendingAction(null)}
        title={modalCopy.title}
        size="md"
      >
        <div className="space-y-5">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">{modalCopy.description}</p>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setPendingAction(null)}
              className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              {t("modal.cancel")}
            </button>
            <button
              type="button"
              onClick={submitResolution}
              disabled={resolveDispute.isPending}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {resolveDispute.isPending ? t("modal.submitting") : t("modal.submit")}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
