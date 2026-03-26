"use client";

import { Skeleton, SkeletonChart } from "../ui/Skeleton";

export function AnalyticsSkeleton() {
  return (
    <div className="min-h-screen p-8 lg:p-12 max-w-7xl mx-auto space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <SkeletonChart />
        <SkeletonChart />
      </div>
    </div>
  );
}
