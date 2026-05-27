"use client";

import { useState } from "react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { useBorrowerLoans } from "../../hooks/useApi";
import { LoanList } from "./LoanList";
import { formatCurrency, formatDate } from "./loanFormatters";
import { Spinner } from "../global_ui/Spinner";

type Filter = "all" | "active" | "overdue";

export function ActiveLoansTracker({ borrowerAddress }: { borrowerAddress: string }) {
  const { loans, stats, isLoading, isError, error, refetch } = useBorrowerLoans(borrowerAddress);
  const [filter, setFilter] = useState<Filter>("active");

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Spinner size="lg" color="#2563eb" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card className="p-6">
        <div className="text-center">
          <p className="text-red-600 mb-4">Error: {error?.message ?? "An error occurred"}</p>
          <Button onClick={() => refetch()}>Retry</Button>
        </div>
      </Card>
    );
  }

  const now = new Date();
  const filteredLoans =
    filter === "overdue"
      ? loans.filter((l) => l.status === "active" && new Date(l.nextPaymentDeadline) < now)
      : filter === "active"
        ? loans.filter((l) => l.status === "active")
        : loans;

  const tabCounts: Record<Filter, number> = {
    active: loans.filter((l) => l.status === "active").length,
    overdue: stats.overdueCount,
    all: loans.length,
  };

  return (
    <div className="space-y-6">
      {/* Stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4 bg-gradient-to-br from-blue-50 to-blue-100">
          <p className="text-sm text-gray-600 mb-1">Active Loans</p>
          <p className="text-3xl font-bold text-blue-600">{stats.totalActive}</p>
        </Card>

        <Card className="p-4 bg-gradient-to-br from-purple-50 to-purple-100">
          <p className="text-sm text-gray-600 mb-1">Total Owed</p>
          <p className="text-2xl font-bold text-purple-600">{formatCurrency(stats.totalOwed)}</p>
        </Card>

        <Card
          className={`p-4 ${
            stats.overdueCount > 0
              ? "bg-gradient-to-br from-red-50 to-red-100"
              : "bg-gradient-to-br from-green-50 to-green-100"
          }`}
        >
          <p className="text-sm text-gray-600 mb-1">Overdue Payments</p>
          <p
            className={`text-3xl font-bold ${
              stats.overdueCount > 0 ? "text-red-600" : "text-green-600"
            }`}
          >
            {stats.overdueCount}
          </p>
        </Card>

        <Card className="p-4 bg-gradient-to-br from-yellow-50 to-yellow-100">
          <p className="text-sm text-gray-600 mb-1">Next Payment</p>
          <p className="text-sm font-semibold text-yellow-700">
            {stats.nextPaymentDue ? formatDate(stats.nextPaymentDue) : "No upcoming"}
          </p>
        </Card>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        {(["active", "overdue", "all"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 font-medium transition-colors ${
              filter === f
                ? `border-b-2 ${
                    f === "overdue"
                      ? "border-red-600 text-red-600"
                      : "border-blue-600 text-blue-600"
                  }`
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)} ({tabCounts[f]})
          </button>
        ))}
      </div>

      {/* Loan list */}
      <LoanList
        loans={filteredLoans}
        variant="detailed"
        emptyTitle={filter === "overdue" ? "No Overdue Loans" : "No Active Loans"}
        emptyDescription={
          filter === "overdue"
            ? "Great! All your payments are on time."
            : "You don't have any active loans at the moment."
        }
        showRequestLoanButton={filter !== "overdue"}
      />
    </div>
  );
}
