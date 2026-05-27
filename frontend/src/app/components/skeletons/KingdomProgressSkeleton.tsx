export function KingdomProgressSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-1/3 rounded bg-gray-200 dark:bg-zinc-800" />
      <div className="space-y-3">
        <div className="h-2 w-full rounded-full bg-gray-200 dark:bg-zinc-800" />
        <div className="h-4 w-1/2 rounded bg-gray-200 dark:bg-zinc-800" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="p-4 bg-gray-50 dark:bg-zinc-900 rounded-lg space-y-2">
            <div className="h-4 w-2/3 rounded bg-gray-200 dark:bg-zinc-800" />
            <div className="h-6 w-1/2 rounded bg-gray-200 dark:bg-zinc-800" />
          </div>
        ))}
      </div>
    </div>
  );
}
