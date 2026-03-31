"use client";

import { useEffect, useRef, useState } from "react";

export type SSEStatus = "connecting" | "connected" | "disconnected" | "fallback";

interface UseSSEOptions<T> {
  /** Full URL of the SSE endpoint. Pass null/undefined to disable. */
  url: string | null | undefined;
  /** Called for every parsed message from the stream. */
  onMessage: (data: T) => void;
  /** Called when the connection opens (backoff reset point). */
  onOpen?: () => void;
  /** Called when the connection closes with an error. */
  onError?: (event: Event) => void;
  /** Optional polling fallback function called when SSE is unavailable or fails. */
  onPoll?: () => void;
  /** Polling interval in ms. Defaults to 30s. */
  pollingInterval?: number;
}

/**
 * Generic SSE hook with exponential backoff reconnection and optional polling fallback.
 *
 * Connects to `url` and calls `onMessage` with each parsed JSON payload.
 * Automatically reconnects on error, backing off up to 30 s.
 * Returns the current connection status for UI indicators.
 *
 * If `onPoll` is provided, it will be called every `pollingInterval` when the SSE stream is down.
 */
export function useSSE<T = unknown>({
  url,
  onMessage,
  onOpen,
  onError,
  onPoll,
  pollingInterval = 30_000,
}: UseSSEOptions<T>): SSEStatus {
  const [status, setStatus] = useState<SSEStatus>("connecting");
  const retryDelay = useRef(1_000);
  const esRef = useRef<EventSource | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep callback refs stable so the effect doesn't need to re-run when they
  // change, which would needlessly restart the connection.
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onPollRef = useRef(onPoll);
  onPollRef.current = onPoll;

  useEffect(() => {
    if (!url) return;

    let cancelled = false;

    const startPolling = () => {
      if (!onPollRef.current || pollIntervalRef.current) return;
      // Immediate poll to refresh data as soon as fallback starts
      onPollRef.current();
      pollIntervalRef.current = setInterval(() => {
        onPollRef.current?.();
      }, pollingInterval);
    };

    const stopPolling = () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };

    function connect() {
      if (cancelled) return;

      // Fallback if browser doesn't support EventSource
      if (typeof window !== "undefined" && !window.EventSource) {
        setStatus("fallback");
        startPolling();
        return;
      }

      setStatus("connecting");

      const es = new EventSource(url as string, { withCredentials: true });
      esRef.current = es;

      es.onopen = () => {
        retryDelay.current = 1_000;
        setStatus("connected");
        stopPolling(); // Stop fallback polling once stream is active
        onOpenRef.current?.();
      };

      es.onmessage = (event: MessageEvent<string>) => {
        try {
          const data = JSON.parse(event.data) as T;
          onMessageRef.current(data);
        } catch {
          // Ignore malformed messages
        }
      };

      es.onerror = (event) => {
        es.close();
        esRef.current = null;

        if (onPollRef.current) {
          setStatus("fallback");
          if (!cancelled) startPolling();
        } else {
          setStatus("disconnected");
        }

        onErrorRef.current?.(event);

        if (!cancelled) {
          const delay = Math.min(retryDelay.current, 30_000);
          retryDelay.current = Math.min(delay * 2, 30_000);
          timeoutRef.current = setTimeout(connect, delay);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
      stopPolling();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [url, pollingInterval]);

  return status;
}
