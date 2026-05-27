"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    if (isOnline) {
      queryClient.refetchQueries({ type: "active" });
    }
  }, [isOnline, queryClient]);

  if (isOnline) return null;

  return (
    <div
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <WifiOff className="h-4 w-4" aria-hidden="true" />
          You appear to be offline. Showing cached data where available.
        </div>
        <button
          type="button"
          onClick={() => queryClient.refetchQueries({ type: "active" })}
          className="rounded-full bg-amber-900 px-3 py-1 text-xs font-semibold text-amber-50 transition hover:bg-amber-800 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
