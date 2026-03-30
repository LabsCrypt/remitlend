"use client";

import { useEffect, useState } from "react";
import { WifiOff, RefreshCw, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Global banner to notify users of network connectivity issues.
 * Provides a clear recovery path and explains that cached data is being used.
 */
export function NetworkStatusBanner() {
  const [isOffline, setIsOffline] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      setIsVisible(true);
    };
    const handleOffline = () => {
      setIsOffline(true);
      setIsVisible(true);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Initial check on mount
    if (typeof navigator !== "undefined") {
      setIsOffline(!navigator.onLine);
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (!isOffline || !isVisible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: "auto", opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        className="sticky top-0 z-[100] w-full border-b border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/30 dark:bg-amber-950/40 dark:text-amber-200"
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <WifiOff className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              You are currently offline. Displaying cached data. Some features may be limited.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-1 rounded-lg bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-200 transition-colors dark:bg-amber-900/50 dark:text-amber-300 dark:hover:bg-amber-900"
            >
              <RefreshCw className="h-3 w-3" />
              Reconnect
            </button>
            <button
              onClick={() => setIsVisible(false)}
              className="rounded-full p-1 hover:bg-amber-100 dark:hover:bg-amber-900"
              aria-label="Close notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}