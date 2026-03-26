"use client";

import { useRouter } from "next/navigation";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import type { BorrowerLoan } from "../../hooks/useApi";
import { formatCurrency, formatDate, getDaysUntilDeadline } from "./loanFormatters";

export interface LoanCardProps {
  loan: BorrowerLoan;
  /**
   * compact — raw status badge, no progress bar, responsive grid.
   *           Used by LoanDashboard.
   * detailed — urgency badge, repayment progress bar, fixed 3-col grid.
   *            Used by ActiveLoansTracker.
   */
  variant?: "compact" | "detailed";
}

export function LoanCard({ loan, variant = "compact" }: LoanCardProps) {
  const router = useRouter();
  const daysUntil = getDaysUntilDeadline(loan.nextPaymentDeadline);
  const isOverdue = daysUntil < 0;
  const isUrgent = daysUntil >= 0 && daysUntil <= 7;

  // ── Badge ──────────────────────────────────────────────────────────────────
  const badge =
    variant === "detailed"
      ? {
          label: isOverdue ? "Overdue" : isUrgent ? "Due Soon" : "On Track",
          className: isOverdue
            ? "bg-red-100 text-red-800"
            : isUrgent
              ? "bg-yellow-100 text-yellow-800"
              : "bg-green-100 text-green-800",
        }
      : {
          label: loan.status.charAt(0).toUpperCase() + loan.status.slice(1),
          className:
            loan.status === "active"
              ? "bg-green-100 text-green-800"
              : loan.status === "pending"
                ? "bg-yellow-100 text-yellow-800"
                : "bg-gray-100 text-gray-800",
        };

  // ── Deadline colours ───────────────────────────────────────────────────────
  const deadlineBg = isOverdue ? "bg-red-50" : isUrgent ? "bg-yellow-50" : "bg-gray-50";
  const deadlineTextColor = isOverdue
    ? "text-red-600"
    : isUrgent
      ? "text-yellow-600"
      : "text-gray-900";
  const deadlineSubColor = isOverdue
    ? "text-red-600"
    : isUrgent
      ? "text-yellow-600"
      : "text-gray-600";
  const deadlineLabel = isOverdue
    ? `${Math.abs(daysUntil)} days overdue`
    : `${daysUntil} days remaining`;

  // ── Progress (detailed only) ───────────────────────────────────────────────
  const totalForProgress = loan.principal + loan.accruedInterest;
  const progress = totalForProgress > 0 ? (loan.totalRepaid / totalForProgress) * 100 : 0;

  return (
    <Card className="p-6 hover:shadow-lg transition-shadow">
      {/* Header */}
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold">Loan #{loan.id}</h3>
          <span className={`inline-block px-2 py-1 text-xs rounded-full mt-1 ${badge.className}`}>
            {badge.label}
          </span>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-600">Total Owed</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(loan.totalOwed)}</p>
        </div>
      </div>

      {/* Repayment progress bar (detailed only) */}
      {variant === "detailed" && (
        <div className="mb-4">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">Repayment Progress</span>
            <span className="font-medium">{progress.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div
        className={`grid gap-4 mb-4 ${
          variant === "compact" ? "grid-cols-1 md:grid-cols-3" : "grid-cols-3"
        }`}
      >
        <div className="bg-gray-50 p-4 rounded-lg">
          <p className="text-sm text-gray-600 mb-1">Principal</p>
          <p className="text-lg font-semibold">{formatCurrency(loan.principal)}</p>
        </div>

        <div className="bg-gray-50 p-4 rounded-lg">
          <p className="text-sm text-gray-600 mb-1">
            {variant === "compact" ? "Accrued Interest" : "Interest"}
          </p>
          <p className="text-lg font-semibold text-orange-600">
            {formatCurrency(loan.accruedInterest)}
          </p>
        </div>

        <div className={`p-4 rounded-lg ${deadlineBg}`}>
          <p className="text-sm text-gray-600 mb-1">Next Payment</p>
          <p
            className={`${variant === "compact" ? "text-lg" : "text-sm"} font-semibold ${deadlineTextColor}`}
          >
            {formatDate(loan.nextPaymentDeadline)}
          </p>
          <p className={`text-xs mt-1 ${deadlineSubColor}`}>{deadlineLabel}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button
          onClick={() => router.push(`/repay/${loan.id}`)}
          className="flex-1"
          variant={isOverdue || isUrgent ? "primary" : "outline"}
        >
          {isOverdue ? "Pay Now (Overdue)" : "Repay Now"}
        </Button>
        <Button variant="outline" onClick={() => router.push(`/loans/${loan.id}`)}>
          {variant === "compact" ? "View Details" : "Details"}
        </Button>
      </div>
    </Card>
  );
}
