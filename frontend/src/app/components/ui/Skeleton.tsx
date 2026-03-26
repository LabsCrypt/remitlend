"use client";

import { type HTMLAttributes } from "react";
import { clsx } from "clsx";

const baseClasses = "animate-pulse rounded bg-zinc-200 dark:bg-zinc-800";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx(baseClasses, className)} {...props} />;
}

export function SkeletonText({ lines = 1, className }: { lines?: number; className?: string }) {
  return (
    <div className={clsx("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={clsx("h-4", i === lines - 1 && lines > 1 ? "w-3/4" : "w-full")}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-9 rounded-lg" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-7 w-32" />
      </div>
    </div>
  );
}

export function SkeletonChart({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950",
        className,
      )}
    >
      <Skeleton className="mb-4 h-5 w-40" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}

export function SkeletonAvatar({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizeClasses = { sm: "h-8 w-8", md: "h-10 w-10", lg: "h-12 w-12" };
  return <Skeleton className={clsx("rounded-full", sizeClasses[size], className)} />;
}

export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={clsx("flex items-center gap-4 p-4", className)}>
      <SkeletonAvatar />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-48" />
      </div>
      <div className="space-y-2 text-right">
        <Skeleton className="ml-auto h-4 w-20" />
        <Skeleton className="ml-auto h-3 w-16" />
      </div>
    </div>
  );
}
