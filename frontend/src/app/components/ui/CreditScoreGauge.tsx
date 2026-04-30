"use client";

import { useMemo } from "react";
import { ArrowUp, ArrowDown, RefreshCw, AlertCircle } from "lucide-react";
import { FinancialTermTooltip } from "./Tooltip";
import { FINANCIAL_EXPLANATIONS } from "./financial-terms";

interface CreditScoreGaugeProps {
  score?: number | null;
  previousScore?: number;
  min?: number;
  max?: number;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

type ScoreBand = {
  label: string;
  color: string;
  arcColor: string;
  range: [number, number];
};

const BANDS: ScoreBand[] = [
  { label: "Poor", color: "text-red-500", arcColor: "#ef4444", range: [300, 579] },
  { label: "Fair", color: "text-yellow-500", arcColor: "#eab308", range: [580, 669] },
  { label: "Good", color: "text-blue-500", arcColor: "#3b82f6", range: [670, 739] },
  { label: "Very Good", color: "text-blue-400", arcColor: "#60a5fa", range: [740, 799] },
  { label: "Excellent", color: "text-green-500", arcColor: "#22c55e", range: [800, 850] },
];

function getBand(score: number): ScoreBand {
  return BANDS.find((b) => score >= b.range[0] && score <= b.range[1]) ?? BANDS[0];
}

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): string {
  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rad(startAngle));
  const y1 = cy + r * Math.sin(rad(startAngle));
  const x2 = cx + r * Math.cos(rad(endAngle));
  const y2 = cy + r * Math.sin(rad(endAngle));
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

export function CreditScoreGauge({
  score,
  previousScore,
  min = 300,
  max = 850,
  isLoading = false,
  error = null,
  onRetry,
}: CreditScoreGaugeProps) {
  const numericScore = typeof score === "number" && Number.isFinite(score) ? score : null;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="relative" role="status" aria-label="Loading credit score">
          <svg width="240" height="160" viewBox="0 60 240 140">
            <path
              d={describeArc(120, 120, 100, -120, 120)}
              fill="none"
              stroke="currentColor"
              strokeWidth="14"
              strokeLinecap="round"
              className="text-zinc-200 dark:text-zinc-800 animate-pulse"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pt-4">
            <RefreshCw className="h-8 w-8 animate-spin text-zinc-400" />
          </div>
        </div>
        <span className="text-sm font-semibold text-zinc-400">Loading score...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="relative" role="alert" aria-label="Error loading credit score">
          <svg width="240" height="160" viewBox="0 60 240 140">
            <path
              d={describeArc(120, 120, 100, -120, 120)}
              fill="none"
              stroke="currentColor"
              strokeWidth="14"
              strokeLinecap="round"
              className="text-zinc-200 dark:text-zinc-800"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pt-4">
            <AlertCircle className="h-8 w-8 text-red-500" />
          </div>
        </div>
        <span className="text-sm font-semibold text-red-600 dark:text-red-400">
          Failed to load score
        </span>
        <p className="max-w-xs text-center text-xs text-zinc-500 dark:text-zinc-400">
          {error.message || "Unable to fetch your credit score"}
        </p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-2 rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        )}
      </div>
    );
  }

  if (numericScore === null || numericScore === 0 || numericScore < min) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="relative" role="img" aria-label="No credit score yet">
          <svg width="240" height="160" viewBox="0 60 240 140">
            <path
              d={describeArc(120, 120, 100, -120, 120)}
              fill="none"
              stroke="currentColor"
              strokeWidth="14"
              strokeLinecap="round"
              className="text-zinc-200 dark:text-zinc-800"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pt-4">
            <span className="text-4xl font-bold text-zinc-400">--</span>
          </div>
        </div>
        <span className="text-sm font-semibold text-zinc-500">No Score Yet</span>
        <p className="max-w-xs text-center text-xs text-zinc-500 dark:text-zinc-400">
          Complete your first remittance or loan repayment to establish your credit score.
        </p>
      </div>
    );
  }

  const band = useMemo(() => getBand(numericScore), [numericScore]);
  const delta = previousScore != null ? numericScore - previousScore : null;

  const cx = 120;
  const cy = 120;
  const r = 100;
  const startAngle = -120;
  const endAngle = 120;
  const totalArc = endAngle - startAngle;

  const clampedScore = Math.max(min, Math.min(max, numericScore));
  const fraction = (clampedScore - min) / (max - min);
  const scoreAngle = startAngle + fraction * totalArc;

  const bandArcs = useMemo(() => {
    return BANDS.map((b) => {
      const bStart = startAngle + ((b.range[0] - min) / (max - min)) * totalArc;
      const bEnd = startAngle + ((Math.min(b.range[1], max) - min) / (max - min)) * totalArc;
      return { ...b, path: describeArc(cx, cy, r, bStart, bEnd) };
    });
  }, [min, max]);

  const activePath = describeArc(cx, cy, r, startAngle, scoreAngle);

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative"
        role="img"
        aria-label={`Credit score: ${numericScore}, ${band.label}`}
      >
        <svg width="240" height="160" viewBox="0 60 240 140">
          {bandArcs.map((b) => (
            <path
              key={b.label}
              d={b.path}
              fill="none"
              stroke="currentColor"
              strokeWidth="14"
              strokeLinecap="round"
              className="text-zinc-200 dark:text-zinc-800"
            />
          ))}

          {bandArcs.map((b) => (
            <path
              key={`color-${b.label}`}
              d={b.path}
              fill="none"
              stroke={b.arcColor}
              strokeWidth="14"
              strokeLinecap="round"
              opacity={0.2}
            />
          ))}

          <path
            d={activePath}
            fill="none"
            stroke={band.arcColor}
            strokeWidth="14"
            strokeLinecap="round"
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center pt-4">
          <div className="flex flex-col items-center">
            <span className={`text-4xl font-bold ${band.color}`}>{numericScore}</span>
            <FinancialTermTooltip
              term="Credit Score"
              explanation={FINANCIAL_EXPLANATIONS.CREDIT_SCORE}
              className="mt-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500"
            />
          </div>
        </div>
      </div>

      <span className={`text-sm font-semibold ${band.color}`}>{band.label}</span>

      {delta !== null && delta !== 0 && (
        <div
          className={`flex items-center gap-1 text-xs font-medium ${
            delta > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
          }`}
        >
          {delta > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          <span>
            {delta > 0 ? "+" : ""}
            {delta} since last change
          </span>
        </div>
      )}

      <p className="max-w-xs text-center text-xs text-zinc-500 dark:text-zinc-400">
        Your credit score ranges from {min} to {max}. Maintain on-time repayments and low{" "}
        <FinancialTermTooltip
          term="utilization"
          explanation={FINANCIAL_EXPLANATIONS.UTILIZATION_RATE}
          className="border-none p-0 h-auto font-medium text-zinc-600 dark:text-zinc-300"
          icon={() => null}
        />{" "}
        to improve your score.
      </p>
    </div>
  );
}
