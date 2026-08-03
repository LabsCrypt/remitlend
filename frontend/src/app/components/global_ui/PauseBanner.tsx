"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface PauseState {
  isPaused: boolean;
  pausedAt: string | null;
  reason: string | null;
  contracts: string[];
}

/**
 * Global pause banner component
 *
 * Displays when smart contracts are paused due to emergency or maintenance.
 * Fetches pause state from backend API and polls periodically to detect when
 * pause is lifted. Related to Issue #1381: Cross-Layer Emergency Pause Propagation.
 */
export function PauseBanner() {
  const [pauseState, setPauseState] = useState<PauseState>({
    isPaused: false,
    pausedAt: null,
    reason: null,
    contracts: [],
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPauseState = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await fetch("/api/status/pause");
      if (!response.ok) {
        throw new Error(`Failed to fetch pause state: ${response.statusText}`);
      }
      const data = await response.json();
      setPauseState(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      // On error, continue polling; fail open
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch pause state on mount
  useEffect(() => {
    fetchPauseState();
  }, []);

  // Poll for pause state changes every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchPauseState, 30 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (!pauseState.isPaused) {
    return null;
  }

  return (
    <div
      className="border-b border-red-200 bg-red-50 px-4 py-3 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
      role="alert"
      aria-live="assertive"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <h3 className="font-semibold">Contract Operations Paused</h3>
            <p className="mt-1 text-sm">
              {pauseState.reason ||
                "Smart contract operations are temporarily unavailable for maintenance or security reasons."}
            </p>
            {pauseState.contracts.length > 0 && (
              <p className="mt-1 text-xs">
                Affected contracts:{" "}
                <code className="font-mono">{pauseState.contracts.join(", ")}</code>
              </p>
            )}
            {pauseState.pausedAt && (
              <p className="mt-1 text-xs">
                Started at {new Date(pauseState.pausedAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={fetchPauseState}
          disabled={isLoading}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-red-900 px-4 py-2 text-sm font-semibold text-red-50 transition hover:bg-red-800 disabled:opacity-50 dark:bg-red-200 dark:text-red-950 dark:hover:bg-red-100"
        >
          {isLoading ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
              Checking...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Check Status
            </>
          )}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-xs opacity-75">
          Note: Unable to fetch latest pause state ({error}). Showing cached information.
        </p>
      )}
    </div>
  );
}
