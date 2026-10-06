"use client";

import { useTranslations } from "next-intl";
import { useAdminGovernancePending } from "../../../hooks/useApi";
import { useAdminGuard } from "../../../hooks/useAdminGuard";

function shortAddress(value: string | null | undefined) {
  if (!value) return "Not configured";
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function timeUntil(value: string | null | undefined) {
  if (!value) return "Not scheduled";
  const deltaMs = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(deltaMs)) return "Unknown";
  if (deltaMs <= 0) return "Executable now";
  const minutes = Math.ceil(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.ceil(minutes / 60)}h`;
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <section className="rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
    </section>
  );
}

function ForbiddenPanel({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      {label}
    </div>
  );
}

export default function GovernancePage() {
  const t = useTranslations("Governance");
  const { isAdmin, isChecking } = useAdminGuard();
  // Gated on a *confirmed* admin role. Previously this fired on every render,
  // including for anonymous visitors, which put the privileged request on the
  // wire before the guard had decided anything (#1884).
  const { data, isLoading, isError } = useAdminGovernancePending({ enabled: isAdmin });

  // An unresolved role is not a permitted role. The old check was
  // `if (role && role !== "admin")`, so a falsy role — anonymous visitor, or an
  // admin session still loading — fell straight through and rendered pending
  // proposals, signer addresses and approval counts.
  if (isChecking || (!isAdmin && isLoading)) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <LoadingPanel label={t("loading")} />
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <ForbiddenPanel label={t("forbidden")} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{t("title")}</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t("description")}</p>
      </div>

      {isLoading ? (
        <LoadingPanel label={t("loading")} />
      ) : isError ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {t("error")}
        </section>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
              <p className="text-xs uppercase tracking-wide text-zinc-500">{t("currentAdmin")}</p>
              <p className="mt-2 font-mono text-sm text-zinc-950 dark:text-zinc-50">
                {shortAddress(data?.currentAdmin)}
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
              <p className="text-xs uppercase tracking-wide text-zinc-500">{t("targetContract")}</p>
              <p className="mt-2 font-mono text-sm text-zinc-950 dark:text-zinc-50">
                {shortAddress(data?.targetContract)}
              </p>
            </div>
          </section>

          {!data?.pendingProposal ? (
            <section className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              {t("empty")}
            </section>
          ) : (
            <section className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-sm text-zinc-500">{t("pendingProposal")}</p>
                  <h2 className="mt-1 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                    {data.pendingProposal.id}
                  </h2>
                  <p className="mt-2 font-mono text-sm text-zinc-600 dark:text-zinc-300">
                    {shortAddress(data.pendingProposal.proposedAdmin)}
                  </p>
                </div>
                <div className="rounded-xl bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-900">
                  {data.pendingProposal.approvalCount}/{data.pendingProposal.threshold}{" "}
                  {t("approvals")}
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-zinc-500">
                    {t("timeToExecutable")}
                  </p>
                  <p className="mt-1 text-sm text-zinc-950 dark:text-zinc-50">
                    {timeUntil(data.pendingProposal.executableAt)}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-zinc-500">{t("expiresAt")}</p>
                  <p className="mt-1 text-sm text-zinc-950 dark:text-zinc-50">
                    {data.pendingProposal.expiresAt ?? "Not configured"}
                  </p>
                </div>
              </div>

              <ul className="mt-6 divide-y divide-zinc-200 rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {data.pendingProposal.signers.map((signer) => (
                  <li key={signer.address} className="flex items-center justify-between px-4 py-3">
                    <span className="font-mono text-sm">{shortAddress(signer.address)}</span>
                    <span
                      className={
                        signer.approved
                          ? "text-sm font-medium text-green-600"
                          : "text-sm font-medium text-zinc-500"
                      }
                    >
                      {signer.approved ? t("approved") : t("pending")}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
