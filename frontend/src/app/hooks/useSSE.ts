"use client";

import { useEffect, useRef, useState } from "react";
import { useUserStore } from "../stores/useUserStore";

export type SSEStatus = "connecting" | "connected" | "disconnected";
export type RealtimeStatus = SSEStatus | "polling";

interface UseSSEOptions<T> {
  /** Full URL of the SSE endpoint. Pass null/undefined to disable. */
  url: string | null | undefined;
  /** Called for every parsed message from the stream. */
  onMessage: (data: T) => void;
  /** Called when the connection opens (backoff reset point). */
  onOpen?: () => void;
  /** Called when the connection closes with an error. */
  onError?: (error: Error) => void;
  /** Invoked while the hook is in fallback polling mode. */
  onFallbackPoll?: () => void | Promise<void>;
}

/**
 * Generic SSE hook with exponential backoff reconnection using fetch + ReadableStream.
 * Supports custom Authorization header which the native EventSource API does not.
 */
export function useSSE<T = unknown>({
  url,
  onMessage,
  onOpen,
  onError,
  onFallbackPoll,
}: UseSSEOptions<T>): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const token = useUserStore((s) => s.authToken);
  const retryDelay = useRef(1_000);
  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onFallbackPollRef = useRef(onFallbackPoll);
  onFallbackPollRef.current = onFallbackPoll;

  useEffect(() => {
    if (!url) {
      setStatus("disconnected");
      return;
    }

    let cancelled = false;

    const stopPolling = () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };

    const startPolling = () => {
      if (pollingIntervalRef.current || !onFallbackPollRef.current) {
        return;
      }

      setStatus("polling");
      void onFallbackPollRef.current();
      pollingIntervalRef.current = setInterval(() => {
        void onFallbackPollRef.current?.();
      }, 10_000);
    };

    async function connect() {
      if (cancelled) return;

      // Clean up previous connection if any
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      setStatus("connecting");
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const headers: Record<string, string> = {
          Accept: "text/event-stream",
        };

        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const response = await fetch(url as string, {
          headers,
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error("Response body is null");
        }

        stopPolling();
        setStatus("connected");
        retryDelay.current = 1_000;
        onOpenRef.current?.();

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            const lines = part.split("\n");
            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const dataStr = line.slice(6);
                try {
                  const data = JSON.parse(dataStr) as T;
                  onMessageRef.current(data);
                } catch (e) {
                  console.error("Failed to parse SSE data", e);
                }
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }

        startPolling();
        onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));

        if (!cancelled) {
          const delay = Math.min(retryDelay.current, 5_000);
          retryDelay.current = Math.min(delay * 2, 30_000);
          timeoutRef.current = setTimeout(connect, delay);
        }
      }
    }

    connect();

    return () => {
      cancelled = true;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      stopPolling();
    };
  }, [url, token]);

  return status;
}
