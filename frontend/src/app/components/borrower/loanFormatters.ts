/** Shared formatting utilities for borrower loan components. */

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

export { formatDate } from "../../utils/date";

export function getDaysUntilDeadline(deadline: string): number {
  const msUntil = new Date(deadline).getTime() - Date.now();
  const days = Math.ceil(msUntil / (1000 * 60 * 60 * 24));
  // Math.ceil maps small negative fractions (e.g. -0.2 for 5h overdue) to -0,
  // which equals 0 and hides sub-24h-overdue deadlines from `daysUntil < 0` checks.
  return msUntil < 0 && days === 0 ? -1 : days;
}
