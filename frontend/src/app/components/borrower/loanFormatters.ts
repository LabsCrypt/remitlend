/** Shared formatting utilities for borrower loan components. */

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function getDaysUntilDeadline(deadline: string, now: number | Date = Date.now()): number {
  const deadlineMs = new Date(deadline).getTime();
  if (Number.isNaN(deadlineMs)) {
    return 0;
  }
  const nowMs = typeof now === "number" ? now : now.getTime();
  const diffMs = deadlineMs - nowMs;

  if (diffMs < 0) {
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}
