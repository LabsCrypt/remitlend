import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import BuildInfoFooter from "@/components/BuildInfoFooter";

export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!["en", "es", "tl"].includes(locale)) {
    notFound();
  }

  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages} locale={locale}>
      {children}
      <BuildInfoFooter />
    </NextIntlClientProvider>
  );
}
