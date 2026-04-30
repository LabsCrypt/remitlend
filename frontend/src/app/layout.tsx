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
import { TooltipProvider } from "./components/ui/Tooltip";

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
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var root=document.documentElement;var stored=localStorage.getItem("${THEME_STORAGE_KEY}");if(stored==="system"){var resolved=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";root.dataset.theme="system";root.classList.toggle("dark",resolved==="dark");}else if(stored==="dark"||stored==="light"){root.dataset.theme=stored;root.classList.toggle("dark",stored==="dark");}else{var theme=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";root.dataset.theme=theme;root.classList.toggle("dark",theme==="dark");}}catch(e){}})()`,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <NextIntlClientProvider locale="en" messages={messages}>
          <QueryProvider>
            <WalletProvider>
              <TooltipProvider delayDuration={300}>
                <DashboardShell>
                  <ErrorBoundary scope="active page" variant="section">
                    {children}
                  </ErrorBoundary>
                </DashboardShell>
              </TooltipProvider>
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
