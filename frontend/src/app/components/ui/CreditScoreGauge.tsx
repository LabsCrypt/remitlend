"use client";

import { useMemo } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";

interface CreditScoreGaugeProps {
  score?: number | null;
  previousScore?: number | null;
  isLoading?: boolean;
  error?: string | null;
  min?: number;
  max?: number;
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
  isLoading = false,
  error = null,
  min = 300,
  max = 850,
}: CreditScoreGaugeProps) {
  const resolvedScore = score ?? min;
  const band = useMemo(() => getBand(resolvedScore), [resolvedScore]);
  const delta = previousScore != null && score != null ? score - previousScore : null;

  const cx = 120;
  const cy = 120;
  const r = 100;
  const startAngle = -120;
  const endAngle = 120;
  const totalArc = endAngle - startAngle;

  const clampedScore = Math.max(min, Math.min(max, resolvedScore));
  const fraction = (clampedScore - min) / (max - min);
  const scoreAngle = startAngle + fraction * totalArc;

  // Background arc segments per band
  const bandArcs = useMemo(() => {
    return BANDS.map((b) => {
      const bStart = startAngle + ((b.range[0] - min) / (max - min)) * totalArc;
      const bEnd = startAngle + ((Math.min(b.range[1], max) - min) / (max - min)) * totalArc;
      return { ...b, path: describeArc(cx, cy, r, bStart, bEnd) };
    });
  }, [max, min, startAngle, totalArc]);

  // Active arc from start to current score
  const activePath = describeArc(cx, cy, r, startAngle, scoreAngle);

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse" aria-busy="true" aria-label="Loading credit score">
        <div className="mx-auto h-40 w-40 rounded-full bg-zinc-200 dark:bg-zinc-800" />
        <div className="mx-auto h-4 w-24 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mx-auto h-3 w-48 rounded bg-zinc-200 dark:bg-zinc-800" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2 text-center" role="status" aria-live="polite">
        <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
          Credit score unavailable
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          We could not reach the score service. Reconnect or try again shortly.
        </p>
      </div>
    );
  }

  if (score == null) {
    return (
      <div className="space-y-2 text-center" role="status" aria-live="polite">
        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          No credit score yet
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Connect your wallet activity to RemitLend to build your on-chain credit profile.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative"
        role="img"
        aria-label={`Credit score: ${resolvedScore}, ${band.label}`}
      >
        <svg width="240" height="160" viewBox="0 60 240 140">
          {/* Background band arcs */}
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

          {/* Colored band segments */}
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

          {/* Active score arc */}
          <path
            d={activePath}
            fill="none"
            stroke={band.arcColor}
            strokeWidth="14"
            strokeLinecap="round"
          />
        </svg>

        {/* Center score display */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-4">
          <span className={`text-4xl font-bold ${band.color}`}>{resolvedScore}</span>
        </div>
      </div>

      {/* Band label */}
      <span className={`text-sm font-semibold ${band.color}`}>{band.label}</span>

      {/* Trend indicator */}
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

      {/* Tooltip / explanation */}
      <p className="max-w-xs text-center text-xs text-zinc-500 dark:text-zinc-400">
        Your credit score ranges from {min} to {max}. Maintain on-time repayments and low
        utilization to improve your score.
      </p>
    </div>
  );
}
