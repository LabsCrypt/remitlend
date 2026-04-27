import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Hook to manage Server-Sent Events with a polling fallback.
 *
 * @param url The SSE endpoint URL
 * @param fetchFallbackData Async function to fetch data manually during fallback
 * @param initialData Initial state for the data
 */
export function useSSE<T>(
  url: string,
  fetchFallbackData: () => Promise<T>,
  initialData: T
) {
  const [data, setData] = useState<T>(initialData);
  const [isLive, setIsLive] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const eventSourceRef = useRef<EventSource | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const startPolling = useCallback(() => {
    if (pollingIntervalRef.current) return;

    // Perform an immediate fetch when entering fallback mode
    fetchFallbackData()
      .then(setData)
      .catch((err) => console.error("Fallback fetch failed:", err));

    pollingIntervalRef.current = setInterval(async () => {
      try {
        const result = await fetchFallbackData();
        setData(result);
      } catch (error) {
        console.error("Polling fallback error:", error);
      }
    }, 30000);
  }, [fetchFallbackData]);

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (eventSourceRef.current) eventSourceRef.current.close();
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsLive(true);
      setRetryCount(0); // Reset backoff on successful connection
      stopPolling();
    };

    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        setData(payload);
      } catch (err) {
        console.error("Failed to parse SSE payload:", err);
      }
    };

    es.onerror = () => {
      es.close();
      setIsLive(false);
      startPolling();

      // Exponential backoff: 1s, 2s, 4s, 8s... capped at 30s
      const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
      setRetryCount((prev) => prev + 1);

      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delay);
    };
  }, [url, retryCount, startPolling, stopPolling]);

  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
      stopPolling();
      if (reconnectTimeoutRef.current)
        clearTimeout(reconnectTimeoutRef.current);
    };
  }, [connect, stopPolling]);

  const statusLabel = isLive ? "Live" : "Refreshing every 30s";

  return { data, isLive, statusLabel };
}
