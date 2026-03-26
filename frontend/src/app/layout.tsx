import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "./components/providers/QueryProvider";
import { DashboardShell } from "./components/global_ui/DashboardShell";
import { Toaster } from "./components/ui/Toast";
import { LevelUpModal } from "./components/gamification/LevelUpModal";

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
    startupImage: [
      {
        url: "/apple-touch-icon.png",
      },
    ],
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
  icons: {
    icon: [
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#3b82f6" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="RemitLend" />
        <meta name="application-name" content="RemitLend" />
        <meta name="msapplication-TileColor" content="#3b82f6" />
        <meta name="msapplication-config" content="/browserconfig.xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/icons/icon-16x16.png" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <QueryProvider>
          <DashboardShell>{children}</DashboardShell>
          <Toaster />
          <LevelUpModal />
        </QueryProvider>
      </body>
    </html>
  );
}
