import { StatusIndicator } from "./StatusIndicator";

export type LoanStatus = "active" | "pending" | "repaid" | "defaulted" | "liquidated";

const STATUS_CONFIG: Record<
  LoanStatus,
  { label: string; tone: "success" | "info" | "danger" | "warning" }
> = {
  active: { label: "Active", tone: "success" },
  repaid: { label: "Repaid", tone: "info" },
  defaulted: { label: "Defaulted", tone: "danger" },
  liquidated: { label: "Liquidated", tone: "danger" },
  pending: { label: "Pending", tone: "warning" },
  liquidated: { label: "Liquidated", tone: "danger" },
};

interface LoanStatusBadgeProps {
  status: LoanStatus | string;
  className?: string;
}

export function LoanStatusBadge({ status, className = "" }: LoanStatusBadgeProps) {
  const config = STATUS_CONFIG[status as LoanStatus];

  if (!config) {
    return (
      <StatusIndicator
        label={status}
        tone="neutral"
        className={className}
        title={`Loan status: ${status}`}
      />
    );
  }

  return (
    <StatusIndicator
      label={config.label}
      tone={config.tone}
      className={className}
      title={`Loan status: ${config.label}`}
    />
  );
}
