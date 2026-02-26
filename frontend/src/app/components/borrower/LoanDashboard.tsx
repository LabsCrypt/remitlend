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
}

export function LoanDashboard({ borrowerAddress }: { borrowerAddress: string }) {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

      if (!response.ok) {
        throw new Error("Failed to fetch loans");
      }

      const data = await response.json();
      setLoans(data.data.loans || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleRepayNow = (loanId: number) => {
    // Navigate to repayment flow
    window.location.href = `/repay/${loanId}`;
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getDaysUntilDeadline = (deadline: string) => {
    const now = new Date();
    const deadlineDate = new Date(deadline);
    const diffTime = deadlineDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <div className="text-center">
          <p className="text-red-600 mb-4">Error: {error}</p>
          <Button onClick={fetchActiveLoans}>Retry</Button>
        </div>
      </Card>
    );
  }

  if (loans.length === 0) {
    return (
      <Card className="p-8">
        <div className="text-center">
          <h3 className="text-xl font-semibold mb-2">No Active Loans</h3>
          <p className="text-gray-600 mb-4">You don't have any active loans at the moment.</p>
          <Button onClick={() => (window.location.href = "/request-loan")}>Request a Loan</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">My Active Loans</h2>
        <Button variant="outline" onClick={fetchActiveLoans}>
          Refresh
        </Button>
      </div>

      {loans.map((loan) => {
        const daysUntil = getDaysUntilDeadline(loan.nextPaymentDeadline);
        const isOverdue = daysUntil < 0;
        const isUrgent = daysUntil >= 0 && daysUntil <= 7;

        return (
          <Card key={loan.id} className="p-6 hover:shadow-lg transition-shadow">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-semibold">Loan #{loan.id}</h3>
                <span
                  className={`inline-block px-2 py-1 text-xs rounded-full mt-1 ${
                    loan.status === "active"
                      ? "bg-green-100 text-green-800"
                      : loan.status === "pending"
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-gray-100 text-gray-800"
                  }`}
                >
                  {loan.status.charAt(0).toUpperCase() + loan.status.slice(1)}
                </span>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-600">Total Owed</p>
                <p className="text-2xl font-bold text-gray-900">{formatCurrency(loan.totalOwed)}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">Principal</p>
                <p className="text-lg font-semibold">{formatCurrency(loan.principal)}</p>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">Accrued Interest</p>
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
                  className={`text-lg font-semibold ${
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
                  {isOverdue
                    ? `${Math.abs(daysUntil)} days overdue`
                    : `${daysUntil} days remaining`}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                onClick={() => handleRepayNow(loan.id)}
                className="flex-1"
                variant={isOverdue || isUrgent ? "primary" : "outline"}
              >
                {isOverdue ? "Pay Now (Overdue)" : "Repay Now"}
              </Button>
              <Button
                variant="outline"
                onClick={() => (window.location.href = `/loans/${loan.id}`)}
              >
                View Details
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
