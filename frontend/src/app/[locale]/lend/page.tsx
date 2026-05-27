import { Metadata } from "next";
import { buildPageMetadata } from "@/app/lib/metadata";
import { LendPageClient } from "./LendPageClient";

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;

  return buildPageMetadata({
    locale,
    path: "/lend",
    title: "Lender Portfolio | RemitLend",
    description:
      "Monitor pool performance, funded loans, deposits, withdrawals, and expected lender yield.",
  });
}

export default function LendPage() {
  return <LendPageClient />;
}
