"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { Breadcrumbs } from "./Breadcrumbs";
import { OfflineBanner } from "./OfflineBanner";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface DashboardShellProps {
  children: ReactNode;
}

export function DashboardShell({ children }: DashboardShellProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 z-50 bg-white dark:bg-zinc-800 dark:text-white p-2 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
      >
        Skip to main content
      </a>
      {/* Mobile Sidebar Backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-zinc-900/50 backdrop-blur-sm lg:hidden"
          aria-hidden="true"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar - Persistent on desktop, drawer on mobile */}
      <Sidebar
        onClose={() => setIsSidebarOpen(false)}
        className={cn(
          "fixed inset-y-0 left-0 z-50 transition-transform duration-300 lg:static lg:translate-x-0",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <Header onMenuClick={() => setIsSidebarOpen(true)} />
        <OfflineBanner />

        {/* Dynamic Page Content */}
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            <Breadcrumbs />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
