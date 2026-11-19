"use client";

import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUserStore, type UserStore } from "../stores/useUserStore";
import { queryKeys, type AppNotification } from "./useApi";
import { useSSE } from "./useSSE";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

type NotificationPayload =
  | AppNotification
  | { type: "init"; notifications: AppNotification[] };

/**
 * Connects to the SSE /api/notifications/stream endpoint and pushes new
 * notifications into the TanStack Query cache so the UI updates immediately.
 *
 * Built on top of the shared {@link useSSE} hook so reconnect/backoff/fallback
 * behaviour is identical to the loan and credit-score streams.
 */
export function useNotificationStream() {
  const queryClient = useQueryClient();
  const token = useUserStore((s: UserStore) => s.authToken);

  // Keep a ref to queryClient so the onMessage closure passed to useSSE
  // always sees the latest instance without re-subscribing the stream.
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;

  const url = token ? `${API_URL}/api/notifications/stream` : null;

  const onMessage = (payload: NotificationPayload) => {
    const qc = queryClientRef.current;

    // Use partial-match setQueriesData so the write lands in every
    // list cache entry readers subscribe to (e.g. the dropdown's
    // ["notifications", {}] and the inbox page's
    // ["notifications", { limit, type, unread }]). setQueryData only
    // matches an exact key, which would drop the update into a cache
    // entry nothing reads until the 60s poll refetches. (#1071)
    qc.setQueriesData(
      { queryKey: queryKeys.notifications.all() },
      (prev: { notifications: AppNotification[]; unreadCount: number } | undefined) => {
        const existing = prev ?? { notifications: [], unreadCount: 0 };

        if ("type" in payload && payload.type === "init") {
          const ids = new Set(existing.notifications.map((n) => n.id));
          const merged = [
            ...payload.notifications.filter((n) => !ids.has(n.id)),
            ...existing.notifications,
          ].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );
          const unreadCount = merged.filter((n) => !n.read).length;
          return { notifications: merged, unreadCount };
        }

        const newNotif = payload as AppNotification;
        if (existing.notifications.some((n) => n.id === newNotif.id)) {
          return existing;
        }

        const notifications = [newNotif, ...existing.notifications];
        return {
          notifications,
          unreadCount: existing.unreadCount + (newNotif.read ? 0 : 1),
        };
      },
    );
  };

  // Fallback: re-fetch the notifications list via REST when SSE is down.
  const onFallbackPoll = () => {
    queryClientRef.current.invalidateQueries({
      queryKey: queryKeys.notifications.all(),
    });
  };

  useSSE<NotificationPayload>({
    url,
    onMessage,
    onFallbackPoll,
  });
}
