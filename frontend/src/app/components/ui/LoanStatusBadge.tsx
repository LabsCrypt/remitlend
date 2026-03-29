type LoanStatus = "active" | "pending" | "repaid" | "defaulted";

const STATUS_STYLES: Record<LoanStatus, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-400",
  repaid: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-400",
  defaulted: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-400",
  pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-400",
};

interface LoanStatusBadgeProps {
  status: LoanStatus | string;
  className?: string;
}

export function LoanStatusBadge({ status, className = "" }: LoanStatusBadgeProps) {
  const styles =
    STATUS_STYLES[status as LoanStatus] ??
    "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  return (
    <span
      role="status"
      aria-label={`Loan status: ${status}`}
      className={`inline-block rounded-full px-3 py-1 text-xs font-medium capitalize ${styles} ${className}`}
    >
      {status}
    </span>
  );
}
