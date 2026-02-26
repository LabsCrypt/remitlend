"use client";

import { useEffect, useState } from "react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";

interface Loan {
  id: number;
  principal: number;
  accruedInterest: number;
  nextPaymentDeadline: string;
  status: "active" | "pending" | "repaid";
  borrower: string;
  totalOwed: number;
  totalRepaid: number;
}

interface LoanStats {
  totalActive: number;
  totalOwed: number;
  nextPaymentDue: string | null;
  overdueCount: number;
}

export function ActiveLoansTracker({ borrowerAddress }: { borrowerAddress: string }) {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [stats, setStats] = useState<LoanStats>({
    totalActive: 0,
    totalOwed: 0,
    nextPaymentDue: null,
    overdueCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "overdue">("active");

  useEffect(() => {
    fetchActiveLoans();
  }, [borrowerAddress]);

  const fetchActiveLoans = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api/loans/borrower/${borrowerAddress}`,
      );

      if (!response.ok) throw new Error("Failed to fetch loans");

      const data = await response.json();
      const fetchedLoans = data.data.loans || [];
      setLoans(fetchedLoans);
      calculateStats(fetchedLoans);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (loansList: Loan[]) => {
    const activeLoans = loansList.filter((l) => l.status === "active");
    const totalOwed = activeLoans.reduce((sum, l) => sum + l.totalOwed, 0);
    const now = new Date();
    const overdueLoans = activeLoans.filter((l) => new Date(l.nextPaymentDeadline) < now);
    const upcomingDeadlines = activeLoans
      .filter((l) => new Date(l.nextPaymentDeadline) >= now)
      .sort(
        (a, b) =>
          new Date(a.nextPaymentDeadline).getTime() - new Date(b.nextPaymentDeadline).getTime(),
      );

    setStats({
      totalActive: activeLoans.length,
      totalOwed,
      nextPaymentDue:
        upcomingDeadlines.length > 0 ? upcomingDeadlines[0].nextPaymentDeadline : null,
      overdueCount: overdueLoans.length,
    });
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  const getDaysUntilDeadline = (deadline: string) => {
    const diffTime = new Date(deadline).getTime() - Date.now();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const getFilteredLoans = () => {
    const now = new Date();
    if (filter === "overdue")
      return loans.filter((l) => l.status === "active" && new Date(l.nextPaymentDeadline) < now);
    if (filter === "active") return loans.filter((l) => l.status === "active");
    return loans;
  };

  if (loading)
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );

  if (error)
    return (
      <Card className="p-6">
        <div className="text-center">
          <p className="text-red-600 mb-4">Error: {error}</p>
          <Button onClick={fetchActiveLoans}>Retry</Button>
        </div>
      </Card>
    );

  const filteredLoans = getFilteredLoans();

  return (
    <div className="space-y-6">
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

      <div className="flex gap-2 border-b border-gray-200">
        {["active", "overdue", "all"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f as typeof filter)}
            className={`px-4 py-2 font-medium transition-colors ${
              filter === f
                ? `border-b-2 ${f === "overdue" ? "border-red-600 text-red-600" : "border-blue-600 text-blue-600"}`
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)} (
            {f === "all"
              ? loans.length
              : f === "overdue"
                ? stats.overdueCount
                : loans.filter((l) => l.status === "active").length}
            )
          </button>
        ))}
      </div>

      {filteredLoans.length === 0 ? (
        <Card className="p-8">
          <div className="text-center">
            <h3 className="text-xl font-semibold mb-2">
              {filter === "overdue" ? "No Overdue Loans" : "No Active Loans"}
            </h3>
            <p className="text-gray-600 mb-4">
              {filter === "overdue"
                ? "Great! All your payments are on time."
                : "You don't have any active loans at the moment."}
            </p>
            {filter !== "overdue" && (
              <Button onClick={() => (window.location.href = "/request-loan")}>
                Request a Loan
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredLoans.map((loan) => {
            const daysUntil = getDaysUntilDeadline(loan.nextPaymentDeadline);
            const isOverdue = daysUntil < 0;
            const isUrgent = daysUntil >= 0 && daysUntil <= 7;
            const progress = (loan.totalRepaid / (loan.principal + loan.accruedInterest)) * 100;

            return (
              <Card key={loan.id} className="p-6 hover:shadow-lg transition-shadow">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-semibold">Loan #{loan.id}</h3>
                    <span
                      className={`inline-block px-2 py-1 text-xs rounded-full mt-1 ${
                        isOverdue
                          ? "bg-red-100 text-red-800"
                          : isUrgent
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-green-100 text-green-800"
                      }`}
                    >
                      {isOverdue ? "Overdue" : isUrgent ? "Due Soon" : "On Track"}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-600">Total Owed</p>
                    <p className="text-2xl font-bold">{formatCurrency(loan.totalOwed)}</p>
                  </div>
                </div>

                <div className="mb-4">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">Repayment Progress</span>
                    <span className="font-medium">{progress.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full"
                      style={{ width: `${Math.min(progress, 100)}%` }}
                    ></div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Principal</p>
                    <p className="text-lg font-semibold">{formatCurrency(loan.principal)}</p>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <p className="text-sm text-gray-600 mb-1">Interest</p>
                    <p className="text-lg font-semibold text-orange-600">
                      {formatCurrency(loan.accruedInterest)}
                    </p>
                  </div>
                  <div
                    className={`p-4 rounded-lg ${
                      isOverdue ? "bg-red-50" : isUrgent ? "bg-yellow-50" : "bg-gray-50"
                    }`}
                  >
                    <p className="text-sm text-gray-600 mb-1">Next Payment</p>
                    <p
                      className={`text-sm font-semibold ${
                        isOverdue ? "text-red-600" : isUrgent ? "text-yellow-600" : "text-gray-900"
                      }`}
                    >
                      {formatDate(loan.nextPaymentDeadline)}
                    </p>
                    <p
                      className={`text-xs mt-1 ${
                        isOverdue ? "text-red-600" : isUrgent ? "text-yellow-600" : "text-gray-600"
                      }`}
                    >
                      {isOverdue ? `${Math.abs(daysUntil)} days overdue` : `${daysUntil} days left`}
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={() => (window.location.href = `/repay/${loan.id}`)}
                    className="flex-1"
                    variant={isOverdue || isUrgent ? "primary" : "outline"}
                  >
                    {isOverdue ? "Pay Now (Overdue)" : "Repay Now"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => (window.location.href = `/loans/${loan.id}`)}
                  >
                    Details
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
