"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Bell, Check, CheckCheck, Clock, Filter, TrendingUp } from "lucide-react";
import {
  useMarkNotificationsRead,
  useNotifications,
  type AppNotification,
  type NotificationType,
} from "../../hooks/useApi";
import { PaginationControls } from "../../components/ui/PaginationControls";
import { EmptyState } from "../../components/ui/EmptyState";

const PAGE_SIZE = 10;

const NOTIFICATION_TYPES: Array<NotificationType | "all"> = [
  "all",
  "loan_approved",
  "repayment_due",
  "repayment_confirmed",
  "loan_defaulted",
  "score_changed",
  "dispute_opened",
  "dispute_contested",
];

function notificationIcon(type: NotificationType) {
  switch (type) {
    case "loan_approved":
      return Check;
    case "repayment_confirmed":
      return CheckCheck;
    case "repayment_due":
      return Clock;
    case "loan_defaulted":
      return AlertTriangle;
    case "score_changed":
      return TrendingUp;
    default:
      return Bell;
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function parseType(value: string | null): NotificationType | "all" {
  return NOTIFICATION_TYPES.includes(value as NotificationType)
    ? (value as NotificationType)
    : "all";
}

function NotificationRow({
  notification,
  onMarkRead,
  unreadLabel,
  markReadLabel,
}: {
  notification: AppNotification;
  onMarkRead: (id: number) => void;
  unreadLabel: string;
  markReadLabel: string;
}) {
  const Icon = notificationIcon(notification.type);

  return (
    <article
      className={`rounded-xl border p-4 transition ${
        notification.read
          ? "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
          : "border-indigo-200 bg-indigo-50/50 dark:border-indigo-900 dark:bg-indigo-950/20"
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-indigo-600 dark:bg-zinc-900 dark:text-indigo-300">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                {notification.title}
              </h2>
              {!notification.read && (
                <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">
                  {unreadLabel}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{notification.message}</p>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              {formatDate(notification.createdAt)}
            </p>
          </div>
        </div>
        {!notification.read && (
          <button
            onClick={() => onMarkRead(notification.id)}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            <Check className="h-4 w-4" />
            {markReadLabel}
          </button>
        )}
      </div>
    </article>
  );
}

export default function NotificationsPage() {
  const t = useTranslations("Notifications");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const markRead = useMarkNotificationsRead();

  const activeType = parseType(searchParams.get("type"));
  const unreadOnly = searchParams.get("unread") === "true";
  const currentPage = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const { data, isLoading, isError } = useNotifications({
    limit: 100,
    type: activeType,
    unread: unreadOnly,
  });

  const notifications = data?.notifications ?? [];
  const filteredNotifications = useMemo(() => {
    return notifications.filter((notification) => {
      const matchesType = activeType === "all" || notification.type === activeType;
      const matchesUnread = !unreadOnly || !notification.read;
      return matchesType && matchesUnread;
    });
  }, [activeType, notifications, unreadOnly]);

  const totalPages = Math.max(1, Math.ceil(filteredNotifications.length / PAGE_SIZE));
  const page = Math.min(currentPage, totalPages);
  const visibleNotifications = filteredNotifications.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );

  const updateParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (!value) next.delete(key);
      else next.set(key, value);
    });
    router.push(`${pathname}?${next.toString()}`);
  };

  return (
    <main className="mx-auto min-h-screen max-w-6xl space-y-6 p-8 lg:p-12">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400">
            {t("eyebrow")}
          </p>
          <h1 className="mt-1 text-3xl font-bold text-zinc-900 dark:text-zinc-50">{t("title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            {t("description")}
          </p>
        </div>
        {data?.unreadCount ? (
          <button
            onClick={() =>
              markRead.mutate(
                notifications
                  .filter((notification) => !notification.read)
                  .map((notification) => notification.id),
              )
            }
            disabled={markRead.isPending}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
          >
            <CheckCheck className="h-4 w-4" />
            {t("markAllVisibleRead")}
          </button>
        ) : null}
      </header>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          <Filter className="h-4 w-4" />
          {t("filters.title")}
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {NOTIFICATION_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => updateParams({ type: type === "all" ? null : type, page: "1" })}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  activeType === type
                    ? "bg-indigo-600 text-white"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {
                  {
                    all: t("types.all"),
                    loan_approved: t("types.loan_approved"),
                    repayment_due: t("types.repayment_due"),
                    repayment_confirmed: t("types.repayment_confirmed"),
                    loan_defaulted: t("types.loan_defaulted"),
                    score_changed: t("types.score_changed"),
                    dispute_opened: t("types.dispute_opened"),
                    dispute_contested: t("types.dispute_contested"),
                  }[type]
                }
              </button>
            ))}
          </div>
          <label className="inline-flex w-fit items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(event) =>
                updateParams({ unread: event.target.checked ? "true" : null, page: "1" })
              }
              className="h-4 w-4 rounded border-zinc-300 text-indigo-600"
            />
            {t("filters.unreadOnly")}
          </label>
        </div>
      </section>

      <section className="space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((item) => (
              <div
                key={item}
                className="h-28 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
              />
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {t("error")}
          </div>
        ) : visibleNotifications.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={t("empty.title")}
            description={t("empty.description")}
            actionLabel={t("empty.action")}
            actionHref={`/${locale}`}
          />
        ) : (
          <>
            <div className="space-y-3">
              {visibleNotifications.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  onMarkRead={(id) => markRead.mutate([id])}
                  unreadLabel={t("unread")}
                  markReadLabel={t("markRead")}
                />
              ))}
            </div>
            <PaginationControls
              currentPage={page}
              totalPages={totalPages}
              hasPrevious={page > 1}
              hasNext={page < totalPages}
              onPageChange={(nextPage) => updateParams({ page: String(nextPage) })}
              onPrevious={() => updateParams({ page: String(Math.max(1, page - 1)) })}
              onNext={() => updateParams({ page: String(Math.min(totalPages, page + 1)) })}
              summary={t("pagination.summary", {
                count: visibleNotifications.length,
                total: filteredNotifications.length,
                page,
              })}
            />
          </>
        )}
      </section>
    </main>
  );
}
