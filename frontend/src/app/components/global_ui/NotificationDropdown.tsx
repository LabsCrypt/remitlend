"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, CheckCheck, AlertTriangle, TrendingUp, Clock, X } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { AnimatePresence, motion } from "framer-motion";
import {
  useNotifications,
  useMarkNotificationsRead,
  useMarkAllNotificationsRead,
  type AppNotification,
  type NotificationType,
} from "../../hooks/useApi";
import { useNotificationStream } from "../../hooks/useNotificationStream";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── Icon & colour helpers ────────────────────────────────────────────────────

function NotificationIcon({ type }: { type: NotificationType }) {
  switch (type) {
    case "loan_approved":
      return <Check className="h-4 w-4 text-emerald-500" />;
    case "repayment_confirmed":
      return <CheckCheck className="h-4 w-4 text-indigo-500" />;
    case "repayment_due":
      return <Clock className="h-4 w-4 text-amber-500" />;
    case "loan_defaulted":
      return <AlertTriangle className="h-4 w-4 text-red-500" />;
    case "score_changed":
      return <TrendingUp className="h-4 w-4 text-violet-500" />;
    default:
      return <Bell className="h-4 w-4 text-zinc-400" />;
  }
}

function iconBg(type: NotificationType): string {
  switch (type) {
    case "loan_approved":
      return "bg-emerald-50 dark:bg-emerald-950/40";
    case "repayment_confirmed":
      return "bg-indigo-50 dark:bg-indigo-950/40";
    case "repayment_due":
      return "bg-amber-50 dark:bg-amber-950/40";
    case "loan_defaulted":
      return "bg-red-50 dark:bg-red-950/40";
    case "score_changed":
      return "bg-violet-50 dark:bg-violet-950/40";
    default:
      return "bg-zinc-100 dark:bg-zinc-800";
  }
}

function loanPath(loanId?: number): string | undefined {
  return loanId !== undefined ? `/loans/${loanId}` : undefined;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── NotificationItem ─────────────────────────────────────────────────────────

function NotificationItem({
  notification,
  onRead,
  onNavigate,
}: {
  notification: AppNotification;
  onRead: (id: number) => void;
  onNavigate: (path: string) => void;
}) {
  const path = loanPath(notification.loanId);

  const handleClick = () => {
    if (!notification.read) onRead(notification.id);
    if (path) onNavigate(path);
  };

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className={cn(
        "flex gap-3 px-4 py-3 transition-colors",
        path ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/60" : "cursor-default",
        !notification.read && "bg-indigo-50/40 dark:bg-indigo-950/20",
      )}
      onClick={handleClick}
    >
      {/* Icon */}
      <div
        className={cn(
          "mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full",
          iconBg(notification.type),
        )}
      >
        <NotificationIcon type={notification.type} />
      </div>

      {/* Text */}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-sm",
            notification.read
              ? "font-normal text-zinc-700 dark:text-zinc-300"
              : "font-semibold text-zinc-900 dark:text-zinc-50",
          )}
        >
          {notification.title}
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
          {notification.message}
        </p>
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
          {relativeTime(notification.createdAt)}
        </p>
      </div>

      {/* Unread dot */}
      {!notification.read && (
        <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-indigo-500" />
      )}
    </motion.li>
  );
}

// ─── NotificationDropdown ────────────────────────────────────────────────────

export function NotificationDropdown() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Real-time SSE stream (no-op when unauthenticated)
  useNotificationStream();

  const { data, isLoading } = useNotifications();
  const markRead = useMarkNotificationsRead();
  const markAllRead = useMarkAllNotificationsRead();

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  // Close on outside click
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const handleBellClick = () => {
    setOpen((v: boolean) => !v);
  };

  const handleReadOne = (id: number) => {
    markRead.mutate([id]);
  };

  const handleMarkAllRead = () => {
    markAllRead.mutate();
  };

  const handleNavigate = (path: string) => {
    router.push(path);
    setOpen(false);
  };

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={handleBellClick}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        className="relative p-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900 rounded-lg transition-colors"
      >
        <Bell className="h-5 w-5" />
        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.span
              key="badge"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className={cn(
                "absolute top-1 right-1 flex items-center justify-center rounded-full border-2 border-white text-white dark:border-zinc-950",
                unreadCount > 9
                  ? "h-4 w-4 text-[9px] font-bold bg-indigo-500"
                  : "h-2.5 w-2.5 bg-indigo-500",
              )}
            >
              {unreadCount > 9 ? "9+" : unreadCount > 1 ? unreadCount : null}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      {/* Dropdown panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            key="panel"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-80 sm:w-96 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900 z-50"
            role="dialog"
            aria-label="Notifications panel"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Notifications
              </h2>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    disabled={markAllRead.isPending}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40 disabled:opacity-50 transition-colors"
                  >
                    <CheckCheck className="h-3 w-3" />
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  aria-label="Close notifications"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="max-h-[28rem] overflow-y-auto overscroll-contain">
              {isLoading ? (
                <div className="flex flex-col gap-2 px-4 py-6">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex gap-3 animate-pulse">
                      <div className="h-8 w-8 rounded-full bg-zinc-100 dark:bg-zinc-800" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 w-3/4 rounded bg-zinc-100 dark:bg-zinc-800" />
                        <div className="h-3 w-full rounded bg-zinc-100 dark:bg-zinc-800" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : notifications.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                  <Bell className="h-8 w-8 text-zinc-300 dark:text-zinc-600" />
                  <p className="text-sm text-zinc-400 dark:text-zinc-500">No notifications yet</p>
                </div>
              ) : (
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  <AnimatePresence initial={false}>
                    {notifications.map((n) => (
                      <NotificationItem
                        key={n.id}
                        notification={n}
                        onRead={handleReadOne}
                        onNavigate={handleNavigate}
                      />
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </div>

            {/* Footer */}
            {notifications.length > 0 && (
              <div className="border-t border-zinc-100 px-4 py-2 dark:border-zinc-800">
                <button
                  onClick={() => {
                    router.push("/loans");
                    setOpen(false);
                  }}
                  className="w-full text-center text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 py-1 transition-colors"
                >
                  View all loans →
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
