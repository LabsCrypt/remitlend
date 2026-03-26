"use client";

import { Skeleton } from "../ui/Skeleton";

export function CreditScoreSkeleton() {
  return (
    <div className="space-y-6">
      {/* Gauge skeleton */}
      <div className="flex flex-col items-center gap-4 rounded-xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-950">
        <Skeleton className="h-48 w-48 rounded-full" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-32" />
      </div>

      {/* Score breakdown skeleton */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <Skeleton className="mb-4 h-5 w-36" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
