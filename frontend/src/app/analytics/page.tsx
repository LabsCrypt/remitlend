"use client";

import dynamic from "next/dynamic";
import { ErrorBoundary } from "../components/global_ui/ErrorBoundary";
import { SkeletonChart } from "../components/ui/Skeleton";

const FinancialPerformanceDashboard = dynamic(
  () =>
    import("../components/dashboards/FinancialPerformanceDashboard").then(
      (module) => module.FinancialPerformanceDashboard,
    ),
  {
    loading: () => (
      <div className="grid gap-6 lg:grid-cols-2">
        <SkeletonChart />
        <SkeletonChart />
      </div>
    ),
    ssr: false,
  },
);

export default function AnalyticsPage() {
  // In a real app, this would come from authentication context
  const userId = "demo_user";

  return (
    <main className="min-h-screen p-8 lg:p-12 max-w-7xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">Analytics Dashboard</h1>
        <p className="text-zinc-500 dark:text-zinc-400 mt-2">
          Visualize your financial performance with interactive charts
        </p>
      </header>

      <ErrorBoundary scope="analytics dashboard" variant="section">
        <FinancialPerformanceDashboard userId={userId} userType="both" />
      </ErrorBoundary>
    </main>
  );
}
