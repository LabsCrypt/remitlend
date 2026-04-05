import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./[locale]/globals.css";
import { QueryProvider } from "./components/providers/QueryProvider";
import { WalletProvider } from "./components/providers/WalletProvider";
import { DashboardShell } from "./components/global_ui/DashboardShell";
import { Toaster } from "./components/ui/Toaster";
import { LevelUpModal } from "./components/gamification/LevelUpModal";
import { GlobalXPGain } from "./components/global_ui/GlobalXPGain";
import { ErrorBoundary } from "./components/global_ui/ErrorBoundary";
import { NextIntlClientProvider } from "next-intl";
import { THEME_STORAGE_KEY } from "./lib/theme";

const DEFAULT_SITE_URL = "http://localhost:3000";

function getMetadataBase() {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SITE_URL;

  try {
    return new URL(configuredUrl);
  } catch {
    return new URL(DEFAULT_SITE_URL);
  }
}

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: getMetadataBase(),
  title: "RemitLend - Borderless P2P Lending & Remittance",
  description:
    "Global peer-to-peer lending and instant remittances powered by blockchain technology. Send money and grow your wealth across borders.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const messages = (await import("../../messages/en.json")).default;

  return (
    <html suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#3b82f6" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="RemitLend" />
        <meta name="application-name" content="RemitLend" />
        <meta name="msapplication-TileColor" content="#3b82f6" />
        <meta name="msapplication-config" content="/browserconfig.xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-96x96.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/icons/icon-96x96.png" />
        <link rel="manifest" href="/manifest.json" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var root=document.documentElement;var stored=localStorage.getItem("${THEME_STORAGE_KEY}");var theme=stored==="dark"||stored==="light"?stored:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");root.dataset.theme=theme;root.classList.toggle("dark",theme==="dark")}catch(e){}})()`,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <NextIntlClientProvider locale="en" messages={messages}>
          <QueryProvider>
            <WalletProvider>
              <DashboardShell>
                <ErrorBoundary scope="active page" variant="section">
                  {children}
                </ErrorBoundary>
              </DashboardShell>
            </WalletProvider>
            <Toaster />
            <LevelUpModal />
            <GlobalXPGain />
          </QueryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
