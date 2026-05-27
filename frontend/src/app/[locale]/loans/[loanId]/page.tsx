import type { Metadata } from "next";
import { buildPageMetadata } from "../../../lib/metadata";
import { LoanDetailsPageClient } from "./LoanDetailsPageClient";

type PageProps = {
  params: Promise<{ locale: string; loanId: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, loanId } = await params;

  return buildPageMetadata({
    locale,
    path: `/loans/${loanId}`,
    title: `Loan #${loanId} | RemitLend`,
    description:
      "View loan details, repayment schedule, collateral status, and current loan status.",
  });
}

export default function LoanDetailsPage() {
  return <LoanDetailsPageClient />;
}
