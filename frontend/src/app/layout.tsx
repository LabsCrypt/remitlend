import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "./components/providers/QueryProvider";
import { DashboardShell } from "./components/global_ui/DashboardShell";
import { Toaster } from "./components/ui/Toast";
import { LevelUpModal } from "./components/gamification/LevelUpModal";
import { PWAInstallPrompt, PWAStatusIndicator } from "@/components/PWAComponents";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RemitLend - Borderless P2P Lending & Remittance",
  description:
    "Global peer-to-peer lending and instant remittances powered by blockchain technology. Send money and grow your wealth across borders.",
  keywords: [
    "P2P Lending",
    "Remittance",
    "Blockchain",
    "DeFi",
    "Global Payments",
    "Borderless Finance",
  ],
  authors: [{ name: "RemitLend Team" }],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "RemitLend",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    title: "RemitLend - Borderless P2P Lending & Remittance",
    description:
      "Global peer-to-peer lending and instant remittances powered by blockchain technology. Send money and grow your wealth across borders.",
    url: "https://remitlend.com",
    siteName: "RemitLend",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "RemitLend - Borderless P2P Lending",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "RemitLend - Borderless P2P Lending & Remittance",
    description:
      "Global peer-to-peer lending and instant remittances powered by blockchain technology. Send money and grow your wealth across borders.",
    images: ["/og-image.png"],
    creator: "@remitlend",
  },
  metadataBase: new URL("https://remitlend.com"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#2563eb" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/icons/icon-16x16.png" />
        <link rel="mask-icon" href="/icons/safari-pinned-tab.svg" color="#2563eb" />
        <meta name="msapplication-TileColor" content="#2563eb" />
        <meta name="msapplication-config" content="/browserconfig.xml" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <QueryProvider>
          <DashboardShell>{children}</DashboardShell>
          <Toaster />
          <LevelUpModal />
          <PWAInstallPrompt />
          <PWAStatusIndicator />
        </QueryProvider>
      </body>
    </html>
  );
}
