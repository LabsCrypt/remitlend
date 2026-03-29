"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, AlertTriangle, CheckCircle2, ExternalLink, Info, X } from "lucide-react";
import { useToastStore, type ToastItem, type ToastType } from "../../stores/useToastStore";

const MAX_VISIBLE_TOASTS = 3;

function getToastStyles(type: ToastType): string {
  switch (type) {
    case "success":
      return "border-green-200 bg-green-50 text-green-900 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-200";
    case "error":
      return "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200";
    case "warning":
      return "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/50 dark:bg-yellow-950/30 dark:text-yellow-200";
    default:
      return "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200";
  }
}

function getToastIcon(type: ToastType) {
  switch (type) {
    case "success":
      return <CheckCircle2 className="h-5 w-5" aria-hidden="true" />;
    case "error":
      return <AlertCircle className="h-5 w-5" aria-hidden="true" />;
    case "warning":
      return <AlertTriangle className="h-5 w-5" aria-hidden="true" />;
    default:
      return <Info className="h-5 w-5" aria-hidden="true" />;
  }
}

function ToastCard({ toast }: { toast: ToastItem }) {
  const dismissToast = useToastStore((state) => state.dismissToast);

  useEffect(() => {
    if (!toast.duration || toast.duration <= 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      dismissToast(toast.id);
    }, toast.duration);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [toast.id, toast.duration, dismissToast]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 24, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 20, scale: 0.96 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={`w-full rounded-xl border p-4 shadow-lg shadow-zinc-900/5 ${getToastStyles(toast.type)}`}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">{getToastIcon(toast.type)}</div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{toast.title}</p>
          {toast.description && <p className="mt-1 text-sm opacity-90">{toast.description}</p>}

          {toast.txHash && toast.explorerUrl && (
            <a
              href={toast.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-2"
            >
              View transaction {toast.txHash.slice(0, 8)}...{toast.txHash.slice(-6)}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          )}

          {toast.action && (
            <button
              type="button"
              onClick={toast.action.onClick}
              className="mt-3 inline-flex rounded-lg border border-current px-2.5 py-1 text-xs font-semibold"
            >
              {toast.action.label}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => dismissToast(toast.id)}
          aria-label="Dismiss notification"
          className="rounded-md p-1 opacity-80 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </motion.div>
  );
}

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts.slice(0, MAX_VISIBLE_TOASTS));

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed right-4 top-4 z-100 flex w-[min(420px,calc(100vw-2rem))] flex-col gap-3"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <ToastCard toast={toast} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
