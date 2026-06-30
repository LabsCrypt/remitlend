import type { Metadata } from "next";
import { buildPageMetadata } from "../../lib/metadata";
import LiquidationsClient from "./LiquidationsClient";

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;

  return buildPageMetadata({
    locale,
    path: "/liquidations",
    title: "Liquidations | RemitLend",
    description:
      "Monitor and manage collateral liquidations for undercollateralized loans to protect pool health.",
  });
}

export default function LiquidationsPage() {
  return <LiquidationsClient />;
}
