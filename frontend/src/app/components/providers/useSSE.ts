import { useEffect, useRef, useState, useCallback } from "react";

/**
 * SSEStatus represents the lifecycle of the real-time event stream.
 */
export type SSEStatus = "connecting" | "connected" | "fallback" | "disconnected";

interface UseSSEOptions<T> {
  /** The SSE endpoint URL. If null, the connection is closed. */
  url: string | null;
  /** Callback triggered when a new message is received via SSE. */
  onMessage: (data: T) => void;
  /** Optional callback for successful connection. */
  onOpen?: () => void;
  /** Optional callback for connection errors. */
  onError?: (err: Event) => void;
  /** Callback for fallback polling logic (e.g., refetching data). */
  onPoll?: () => void;
  /** Polling interval in milliseconds. Defaults to 30s. */
  pollingInterval?: number;
}

/**
 * useSSE hook provides real-time updates with automatic exponential backoff
 * and a polling fallback mechanism for resilience.
 */
export function useSSE<T>({
  url,
  onMessage,
  onOpen,
  onError,
  onPoll,
  pollingInterval = 30000,
}: UseSSEOptions<T>) {
  const [status, setStatus] = useState<SSEStatus>("disconnected");

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const backoffRef = useRef(1000); // Start with 1s backoff

  // Store callbacks in a ref to avoid effect re-runs while keeping logic fresh
  const callbacks = useRef({ onMessage, onOpen, onError, onPoll });
  useEffect(() => {
    callbacks.current = { onMessage, onOpen, onError, onPoll };
  }, [onMessage, onOpen, onError, onPoll]);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) return;

    setStatus("fallback");
    if (callbacks.current.onPoll) {
      callbacks.current.onPoll(); // Trigger immediate refresh
      pollingIntervalRef.current = setInterval(() => {
        callbacks.current.onPoll?.();
      }, pollingInterval);
    }
  }, [pollingInterval]);

  useEffect(() => {
    if (!url) {
      cleanup();
      setStatus("disconnected");
      return;
    }

    let isCancelled = false;

    const connect = () => {
      if (isCancelled) return;

      // Close existing SSE but keep polling active while attempting reconnection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      setStatus("connecting");

      const es = new EventSource(url, { withCredentials: true });
      eventSourceRef.current = es;

      es.onopen = () => {
        if (isCancelled) return;
        backoffRef.current = 1000; // Reset backoff on success
        setStatus("connected");

        // Stop polling fallback once SSE is live
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        callbacks.current.onOpen?.();
      };

      es.onmessage = (event) => {
        if (isCancelled) return;
        try {
          const data = JSON.parse(event.data);
          callbacks.current.onMessage(data);
        } catch {
          /* Ignore malformed JSON */
        }
      };

      es.onerror = (err) => {
        if (isCancelled) return;
        es.close();
        eventSourceRef.current = null;
        callbacks.current.onError?.(err);

        // Fallback to polling while SSE is down
        startPolling();

        // Reconnect SSE with exponential backoff (cap at 30s)
        const delay = Math.min(backoffRef.current, 30000);
        backoffRef.current = Math.min(delay * 2, 30000);
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      isCancelled = true;
      cleanup();
    };
  }, [url, pollingInterval, cleanup, startPolling]);

  return status;
}
