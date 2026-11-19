"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import type { BorrowerLoan } from "../../hooks/useApi";
import { formatCurrency, formatDate, getDaysUntilDeadline } from "./loanFormatters";
import { LoanStatusBadge } from "../ui/LoanStatusBadge";

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
  const locale = useLocale();
  const t = useTranslations("LoanCard");
  const daysUntil = getDaysUntilDeadline(loan.nextPaymentDeadline);
  const isOverdue = daysUntil < 0;
  const isUrgent = daysUntil >= 0 && daysUntil <= 7;
  const isLiquidated = loan.status === "liquidated";
  const isDefaulted = loan.status === "defaulted";
  const isTerminalDistressed = isDefaulted || isLiquidated;

  // ── Badge ──────────────────────────────────────────────────────────────────
  const badge =
    variant === "detailed"
      ? {
          label: isLiquidated
            ? t("liquidated")
            : isDefaulted
              ? t("defaulted")
              : isOverdue
                ? t("overdue")
                : isUrgent
                  ? t("dueSoon")
                  : t("onTrack"),
          className: isTerminalDistressed
            ? "bg-red-900 text-white"
            : isOverdue
              ? "bg-red-100 text-red-800"
              : isUrgent
                ? "bg-yellow-100 text-yellow-800"
                : "bg-green-100 text-green-800",
        }
      : null;

  // ── Deadline colours ───────────────────────────────────────────────────────
  const deadlineBg = isTerminalDistressed
    ? "bg-red-900/20"
    : isOverdue
      ? "bg-red-50"
      : isUrgent
        ? "bg-yellow-50"
        : "bg-gray-50";
  const deadlineTextColor = isTerminalDistressed
    ? "text-red-900"
    : isOverdue
      ? "text-red-600"
      : isUrgent
        ? "text-yellow-600"
        : "text-gray-900";
  const deadlineSubColor = isTerminalDistressed
    ? "text-red-700"
    : isOverdue
      ? "text-red-600"
      : isUrgent
        ? "text-yellow-600"
        : "text-gray-600";
  const deadlineLabel = isLiquidated
    ? t("liquidatedLabel")
    : isDefaulted
      ? t("defaultedLabel")
      : isOverdue
        ? t("daysOverdue", { days: Math.abs(daysUntil) })
        : t("daysRemaining", { days: daysUntil });

  // ── Progress (detailed only) ───────────────────────────────────────────────
  const totalForProgress = loan.principal + loan.accruedInterest + (loan.accruedLateFee ?? 0);
  const progress =
    totalForProgress > 0
      ? Math.min(100, Math.max(0, (loan.totalRepaid / totalForProgress) * 100))
      : 0;

  return (
    <Card className="p-6 hover:shadow-lg transition-shadow">
      {/* Header */}
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold">{t("loanNumber", { id: loan.id })}</h3>
          {badge ? (
            <span className={`inline-block px-2 py-1 text-xs rounded-full mt-1 ${badge.className}`}>
              {badge.label}
            </span>
          ) : (
            <LoanStatusBadge status={loan.status} className="mt-1" />
          )}
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-600">{t("totalOwed")}</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(loan.totalOwed)}</p>
        </div>
      </div>

      {/* Repayment progress bar (detailed only) */}
      {variant === "detailed" && (
        <div className="mb-4">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">{t("repaymentProgress")}</span>
            <span className="font-medium">{progress.toFixed(1)}%</span>
          </div>
          <div
            className="w-full bg-gray-200 rounded-full h-2"
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t("repaymentProgressAria", { percent: progress.toFixed(1) })}
          >
            <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${progress}%` }} />
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
          <p className="text-sm text-gray-600 mb-1">{t("principal")}</p>
          <p className="text-lg font-semibold">{formatCurrency(loan.principal)}</p>
        </div>

        <div className="bg-gray-50 p-4 rounded-lg">
          <p className="text-sm text-gray-600 mb-1">
            {variant === "compact" ? t("accruedInterest") : t("interest")}
          </p>
          <p className="text-lg font-semibold text-orange-600">
            {formatCurrency(loan.accruedInterest)}
          </p>
        </div>

        <div className={`p-4 rounded-lg ${deadlineBg}`}>
          <p className="text-sm text-gray-600 mb-1">{t("nextPayment")}</p>
          <p
            className={`${
              variant === "compact" ? "text-lg" : "text-sm"
            } font-semibold ${deadlineTextColor}`}
          >
            {formatDate(loan.nextPaymentDeadline, locale)}
          </p>
          <p className={`text-xs mt-1 ${deadlineSubColor}`}>{deadlineLabel}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        {isTerminalDistressed ? (
          <>
            <Button
              onClick={() => router.push(`/${locale}/loans/${loan.id}`)}
              className="flex-1"
              variant="primary"
            >
              {t("contactSupport")}
            </Button>
            <Button variant="outline" onClick={() => router.push(`/${locale}/loans/${loan.id}`)}>
              {variant === "compact" ? t("viewDetails") : t("details")}
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={() => router.push(`/${locale}/repay/${loan.id}`)}
              className="flex-1"
              variant={isOverdue || isUrgent ? "primary" : "outline"}
            >
              {isOverdue ? t("payNowOverdue") : t("repayNow")}
            </Button>
            <Button variant="outline" onClick={() => router.push(`/${locale}/loans/${loan.id}`)}>
              {variant === "compact" ? t("viewDetails") : t("details")}
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
