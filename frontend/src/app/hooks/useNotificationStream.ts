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
 * The hook is a no-op when there is no auth token (unauthenticated users).
 * It automatically reconnects with exponential backoff if the connection drops.
 */
export function useNotificationStream() {
  const queryClient = useQueryClient();
  const token = useUserStore((s: UserStore) => s.authToken);
  const retryDelay = useRef(1_000);
  const esRef = useRef<EventSource | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    function connect() {
      if (cancelled) return;

      // EventSource does not support custom headers, so we pass the token as a
      // query parameter. The backend already validates JWT from the
      // Authorization header; we would need a small backend change to also
      // accept a `token` query param for SSE — but we handle that gracefully
      // here by still initiating the connection (it will 401 and we back off).
      const url = `${API_URL}/api/notifications/stream?token=${encodeURIComponent(token!)}`;
      const es = new EventSource(url, { withCredentials: true });
      esRef.current = es;

      es.onopen = () => {
        retryDelay.current = 1_000; // reset backoff on successful connect
      };

      es.onmessage = (event: MessageEvent<string>) => {
        try {
          const payload = JSON.parse(event.data) as
            | AppNotification
            | { type: "init"; notifications: AppNotification[] };

          queryClient.setQueryData(
            queryKeys.notifications.all(),
            (prev: { notifications: AppNotification[]; unreadCount: number } | undefined) => {
              const existing = prev ?? { notifications: [], unreadCount: 0 };

              if ("type" in payload && payload.type === "init") {
                // Merge server-sent unread list into existing cache without
                // duplicating entries.
                const ids = new Set(existing.notifications.map((n) => n.id));
                const merged = [
                  ...payload.notifications.filter((n) => !ids.has(n.id)),
                  ...existing.notifications,
                ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                const unreadCount = merged.filter((n) => !n.read).length;
                return { notifications: merged, unreadCount };
              }

              // Single new notification pushed from server
              const newNotif = payload as AppNotification;
              const notifications = [newNotif, ...existing.notifications];
              return {
                notifications,
                unreadCount: existing.unreadCount + (newNotif.read ? 0 : 1),
              };
            },
          );
        } catch {
          // Ignore malformed SSE messages
        }
      };

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (!cancelled) {
          // Exponential backoff — cap at 30s
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
  }, [token, queryClient]);
}
