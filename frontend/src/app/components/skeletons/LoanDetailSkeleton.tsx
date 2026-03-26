"use client";

import { Skeleton } from "../ui/Skeleton";

export function LoanDetailSkeleton() {
  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="rounded-3xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-3 h-8 w-32" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        {/* Repayment plan */}
        <div className="rounded-3xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <Skeleton className="h-5 w-36" />
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="mt-2 h-6 w-20" />
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar */}
        <div className="rounded-3xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      </div>
    </section>
  );
}
