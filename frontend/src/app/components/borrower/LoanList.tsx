"use client";

import { useRouter } from "next/navigation";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { LoanCard } from "./LoanCard";
import type { BorrowerLoan } from "../../hooks/useApi";

interface LoanListProps {
  loans: BorrowerLoan[];
  variant?: "compact" | "detailed";
  emptyTitle?: string;
  emptyDescription?: string;
  /** Show "Request a Loan" CTA in the empty state. */
  showRequestLoanButton?: boolean;
}

export function LoanList({
  loans,
  variant = "compact",
  emptyTitle = "No Active Loans",
  emptyDescription = "You don't have any active loans at the moment.",
  showRequestLoanButton = false,
}: LoanListProps) {
  const router = useRouter();

  if (loans.length === 0) {
    return (
      <Card className="p-8">
        <div className="text-center">
          <h3 className="text-xl font-semibold mb-2">{emptyTitle}</h3>
          <p className="text-gray-600 mb-4">{emptyDescription}</p>
          {showRequestLoanButton && (
            <Button onClick={() => router.push("/request-loan")}>Request a Loan</Button>
          )}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {loans.map((loan) => (
        <LoanCard key={loan.id} loan={loan} variant={variant} />
      ))}
    </div>
  );
}
