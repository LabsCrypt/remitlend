import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "./components/providers/QueryProvider";
import { WalletProvider } from "./components/providers/WalletProvider";
import { DashboardShell } from "./components/global_ui/DashboardShell";
import { Toaster } from "./components/ui/Toast";
import { LevelUpModal } from "./components/gamification/LevelUpModal";
import { GlobalXPGain } from "./components/global_ui/GlobalXPGain";
import { ErrorBoundary } from "./components/global_ui/ErrorBoundary";

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("remitlend-theme");var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme:dark)").matches);if(d)document.documentElement.classList.add("dark")}catch(e){}})()`,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <QueryProvider>
          <WalletProvider>
            <DashboardShell>
              <ErrorBoundary scope="active page" variant="section">
                {children}
              </ErrorBoundary>
            </DashboardShell>
            <Toaster />
            <LevelUpModal />
            <GlobalXPGain />
          </WalletProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
