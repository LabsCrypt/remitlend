"use client";

import { AlertTriangle, ShieldCheck } from "lucide-react";

export interface LoanHealthData {
  collateralLocked?: number;
  totalOwed: number;
  collateralRatio?: number;
  healthFactor?: number;
  liquidationThreshold?: number;
  healthSource?: "contract" | "backend";
}

interface LoanHealthLabels {
  title: string;
  loading: string;
  unavailableTitle: string;
  unavailableDescription: string;
  collateral: string;
  totalDebt: string;
  threshold: string;
  sourceContract: string;
  sourceBackend: string;
  sourceDerived: string;
  cta: string;
  states: {
    healthy: string;
    watch: string;
    atRisk: string;
  };
  descriptions: {
    healthy: string;
    watch: string;
    atRisk: string;
  };
}

interface LoanHealthProps {
  loan?: LoanHealthData;
  isLoading?: boolean;
  isError?: boolean;
  topUpHref: string;
  labels: LoanHealthLabels;
}

const DEFAULT_LIQUIDATION_THRESHOLD = 1.25;
const SAFETY_MARGIN = 0.15;

function normalizeRatio(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value > 10 ? value / 100 : value;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function LoanHealth({ loan, isLoading, isError, topUpHref, labels }: LoanHealthProps) {
  if (isLoading) {
    return (
      <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
        <div className="h-4 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-4 h-3 w-full animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{labels.loading}</p>
      </section>
    );
  }

  const collateral = loan?.collateralLocked ?? 0;
  const totalDebt = loan?.totalOwed ?? 0;
  const backendRatio = normalizeRatio(loan?.collateralRatio);
  const backendHealthFactor = normalizeRatio(loan?.healthFactor);
  const derivedRatio = collateral > 0 && totalDebt > 0 ? collateral / totalDebt : null;
  const ratio = backendHealthFactor ?? backendRatio ?? derivedRatio;
  const threshold = normalizeRatio(loan?.liquidationThreshold) ?? DEFAULT_LIQUIDATION_THRESHOLD;

  if (isError || !ratio || totalDebt <= 0) {
    return (
      <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{labels.title}</h2>
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-semibold">{labels.unavailableTitle}</p>
          <p className="mt-1">{labels.unavailableDescription}</p>
        </div>
      </section>
    );
  }

  const dangerLine = threshold + SAFETY_MARGIN;
  const state = ratio <= threshold ? "atRisk" : ratio <= dangerLine ? "watch" : "healthy";
  const tone =
    state === "atRisk"
      ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
      : state === "watch"
        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
        : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200";
  const barTone =
    state === "atRisk" ? "bg-red-500" : state === "watch" ? "bg-amber-500" : "bg-emerald-500";
  const source =
    loan?.healthSource === "contract"
      ? labels.sourceContract
      : loan?.healthSource === "backend" || backendRatio || backendHealthFactor
        ? labels.sourceBackend
        : labels.sourceDerived;
  const barWidth = `${Math.min(100, Math.max(6, (ratio / (threshold + 0.5)) * 100))}%`;

  return (
    <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{labels.title}</h2>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{source}</p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}
        >
          {state === "healthy" ? (
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {labels.states[state]}
        </span>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400">
          <span>{formatPercent(ratio)}</span>
          <span>{labels.threshold}: {formatPercent(threshold)}</span>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div className={`h-full rounded-full ${barTone}`} style={{ width: barWidth }} />
        </div>
      </div>

      <p className="mt-4 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
        {labels.descriptions[state]}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-2xl bg-zinc-50 p-3 dark:bg-zinc-900">
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">{labels.collateral}</dt>
          <dd className="mt-1 font-semibold text-zinc-900 dark:text-zinc-50">
            {formatCurrency(collateral)}
          </dd>
        </div>
        <div className="rounded-2xl bg-zinc-50 p-3 dark:bg-zinc-900">
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">{labels.totalDebt}</dt>
          <dd className="mt-1 font-semibold text-zinc-900 dark:text-zinc-50">
            {formatCurrency(totalDebt)}
          </dd>
        </div>
      </dl>

      {state !== "healthy" ? (
        <a
          href={topUpHref}
          className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {labels.cta}
        </a>
      ) : null}
    </section>
  );
}
