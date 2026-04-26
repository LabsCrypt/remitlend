import { Skeleton } from "../ui/Skeleton";

export function AchievementsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-1/3 rounded bg-gray-200 dark:bg-zinc-800" />
      <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-zinc-800" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-gray-200 dark:border-zinc-800 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="h-12 w-12 rounded-full bg-gray-200 dark:bg-zinc-800 flex-shrink-0" />
              <div className="flex-1 space-y-2 min-w-0">
                <div className="h-4 w-2/3 rounded bg-gray-200 dark:bg-zinc-800" />
                <div className="h-3 w-full rounded bg-gray-100 dark:bg-zinc-800" />
                <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-zinc-800" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
