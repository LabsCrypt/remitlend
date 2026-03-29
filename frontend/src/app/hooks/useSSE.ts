"use client";

import { useEffect, useRef, useState } from "react";

export type SSEStatus = "connecting" | "connected" | "disconnected";

interface UseSSEOptions<T> {
  /** Full URL of the SSE endpoint. Pass null/undefined to disable. */
  url: string | null | undefined;
  /** Called for every parsed message from the stream. */
  onMessage: (data: T) => void;
  /** Called when the connection opens (backoff reset point). */
  onOpen?: () => void;
  /** Called when the connection closes with an error. */
  onError?: (event: Event) => void;
}

/**
 * Generic SSE hook with exponential backoff reconnection.
 *
 * Connects to `url` and calls `onMessage` with each parsed JSON payload.
 * Automatically reconnects on error, backing off up to 30 s.
 * Returns the current connection status for UI indicators.
 */
export function useSSE<T = unknown>({
  url,
  onMessage,
  onOpen,
  onError,
}: UseSSEOptions<T>): SSEStatus {
  const [status, setStatus] = useState<SSEStatus>("connecting");
  const retryDelay = useRef(1_000);
  const esRef = useRef<EventSource | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep callback refs stable so the effect doesn't need to re-run when they
  // change, which would needlessly restart the connection.
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!url) return;

    let cancelled = false;

    function connect() {
      if (cancelled) return;
      setStatus("connecting");

      const es = new EventSource(url as string, { withCredentials: true });
      esRef.current = es;

      es.onopen = () => {
        retryDelay.current = 1_000;
        setStatus("connected");
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
        setStatus("disconnected");
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
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [url]);

  return status;
}
