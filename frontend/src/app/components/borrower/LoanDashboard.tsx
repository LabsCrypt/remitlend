"use client";

import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { useBorrowerLoans } from "../../hooks/useApi";
import { LoanList } from "./LoanList";

export function LoanDashboard({ borrowerAddress }: { borrowerAddress: string }) {
  const { loans, isLoading, isError, error, refetch } = useBorrowerLoans(borrowerAddress);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
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

  const activeLoans = loans.filter((l) => l.status === "active");

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">My Active Loans</h2>
        <Button variant="outline" onClick={() => refetch()}>
          Refresh
        </Button>
      </div>

      <LoanList
        loans={activeLoans}
        variant="compact"
        emptyTitle="No Active Loans"
        emptyDescription="You don't have any active loans at the moment."
        showRequestLoanButton
      />
    </div>
  );
}
