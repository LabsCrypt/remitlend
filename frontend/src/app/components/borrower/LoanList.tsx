"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { LoanCard } from "./LoanCard";
import { PaginationControls } from "../ui/PaginationControls";
import type { BorrowerLoan } from "../../hooks/useApi";

interface LoanListProps {
  loans: BorrowerLoan[];
  variant?: "compact" | "detailed";
  emptyTitle?: string;
  emptyDescription?: string;
  /** Show "Request a Loan" CTA in the empty state. */
  showRequestLoanButton?: boolean;
}

const PAGE_SIZE = 20;

export function LoanList({
  loans,
  variant = "compact",
  emptyTitle = "No Active Loans",
  emptyDescription = "You don't have any active loans at the moment.",
  showRequestLoanButton = false,
}: LoanListProps) {
  const router = useRouter();
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(loans.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedLoans = useMemo(
    () => loans.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [currentPage, loans],
  );

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
      {paginatedLoans.map((loan) => (
        <LoanCard key={loan.id} loan={loan} variant={variant} />
      ))}

      <PaginationControls
        currentPage={currentPage}
        totalPages={totalPages}
        hasPrevious={currentPage > 1}
        hasNext={currentPage < totalPages}
        onPageChange={setPage}
        onPrevious={() => setPage((previous) => Math.max(1, previous - 1))}
        onNext={() => setPage((previous) => Math.min(totalPages, previous + 1))}
        summary={`Showing ${(currentPage - 1) * PAGE_SIZE + 1}-${Math.min(
          currentPage * PAGE_SIZE,
          loans.length,
        )} of ${loans.length} loans`}
      />
    </div>
  );
}
