import { CheckCircle2, AlertTriangle, Clock3, HelpCircle, type LucideIcon } from "lucide-react";

type StatusTone = "success" | "danger" | "warning" | "info" | "neutral";

const TONE_STYLES: Record<StatusTone, string> = {
  success: "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400",
  danger: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400",
  warning: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
  info: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400",
  neutral: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

const DOT_STYLES: Record<StatusTone, string> = {
  success: "bg-green-500",
  danger: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-blue-500",
  neutral: "bg-zinc-500",
};

const DEFAULT_ICONS: Record<StatusTone, LucideIcon> = {
  success: CheckCircle2,
  danger: AlertTriangle,
  warning: Clock3,
  info: Clock3,
  neutral: HelpCircle,
};

interface StatusIndicatorProps {
  label: string;
  tone: StatusTone;
  className?: string;
  title?: string;
  icon?: LucideIcon;
  iconOnly?: boolean;
}

export function StatusIndicator({
  label,
  tone,
  className = "",
  title,
  icon,
  iconOnly = false,
}: StatusIndicatorProps) {
  const Icon = icon ?? DEFAULT_ICONS[tone];

  return (
    <span
      role="status"
      aria-label={title ?? label}
      title={title ?? label}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${TONE_STYLES[tone]} ${className}`}
    >
      {iconOnly ? (
        <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      ) : (
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${DOT_STYLES[tone]}`} />
      )}
      <span>{label}</span>
    </span>
  );
}
