import type { Metadata } from "next";
import { buildPageMetadata } from "../../lib/metadata";
import KingdomClient from "./KingdomClient";

type PageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;

  return buildPageMetadata({
    locale,
    path: "/kingdom",
    title: "Kingdom | RemitLend",
    description:
      "Track your lending kingdom progress, achievements, and exclusive rewards through our gamification system.",
  });
}

export default function KingdomPage() {
  return <KingdomClient />;
}
