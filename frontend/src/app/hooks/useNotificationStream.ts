"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUserStore, type UserStore } from "../stores/useUserStore";
import { queryKeys, type AppNotification } from "./useApi";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Connects to the SSE /api/notifications/stream endpoint and pushes new
 * notifications into the TanStack Query cache so the UI updates immediately.
 *
 * Uses fetch + ReadableStream to support custom Authorization header.
 */
export function useNotificationStream() {
  const queryClient = useQueryClient();
  const token = useUserStore((s: UserStore) => s.authToken);
  const retryDelay = useRef(1_000);
  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    async function connect() {
      if (cancelled) return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const url = `${API_URL}/api/notifications/stream`;
        const response = await fetch(url, {
          headers: {
            "Accept": "text/event-stream",
            "Authorization": `Bearer ${token}`,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`SSE failed: ${response.status}`);
        }

        if (!response.body) {
          throw new Error("No response body");
        }

        retryDelay.current = 1_000;

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
                  const payload = JSON.parse(dataStr) as
                    | AppNotification
                    | { type: "init"; notifications: AppNotification[] };

                  queryClient.setQueryData(
                    queryKeys.notifications.all(),
                    (prev: { notifications: AppNotification[]; unreadCount: number } | undefined) => {
                      const existing = prev ?? { notifications: [], unreadCount: 0 };

                      if ("type" in payload && payload.type === "init") {
                        const ids = new Set(existing.notifications.map((n) => n.id));
                        const merged = [
                          ...payload.notifications.filter((n) => !ids.has(n.id)),
                          ...existing.notifications,
                        ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                        const unreadCount = merged.filter((n) => !n.read).length;
                        return { notifications: merged, unreadCount };
                      }

                      const newNotif = payload as AppNotification;
                      // Avoid duplicates
                      if (existing.notifications.some(n => n.id === newNotif.id)) {
                        return existing;
                      }
                      const notifications = [newNotif, ...existing.notifications];
                      return {
                        notifications,
                        unreadCount: existing.unreadCount + (newNotif.read ? 0 : 1),
                      };
                    },
                  );
                } catch (e) {
                  console.error("Failed to parse notification SSE data", e);
                }
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }

        if (!cancelled) {
          const delay = Math.min(retryDelay.current, 30_000);
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
    };
  }, [token, queryClient]);
}
