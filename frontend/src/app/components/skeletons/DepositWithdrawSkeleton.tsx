"use client";

import { Skeleton, SkeletonCard } from "../ui/Skeleton";

export function DepositWithdrawSkeleton() {
  return (
    <div className="space-y-4 rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
      <Skeleton className="h-6 w-32" />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-9 w-full rounded-full" />
        </div>

        <div className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-9 w-full rounded-full" />
        </div>
      </div>
    </div>
  );
}
