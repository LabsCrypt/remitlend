"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { CreditScoreDataPoint } from "../charts/CreditScoreTrendChart";
import type { YieldDataPoint } from "../charts/YieldEarningsChart";
import { useCreditScoreHistory, useYieldHistory } from "@/app/hooks/useApi";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { SkeletonChart } from "../ui/Skeleton";
import { RefreshCw } from "lucide-react";

const CreditScoreTrendChart = dynamic(
  () =>
    import("../charts/CreditScoreTrendChart").then(
      (module) => module.CreditScoreTrendChart,
    ),
  {
    loading: () => <SkeletonChart className="h-full" />,
    ssr: false,
  },
);

const YieldEarningsChart = dynamic(
  () =>
    import("../charts/YieldEarningsChart").then(
      (module) => module.YieldEarningsChart,
    ),
  {
    loading: () => <SkeletonChart className="h-full" />,
    ssr: false,
  },
);

interface FinancialPerformanceDashboardProps {
  userId: string;
  userType?: "borrower" | "lender" | "both";
}

// Mock data generator for demo purposes
const generateMockCreditScoreData = (): CreditScoreDataPoint[] => {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const events = [
    "On-time payment",
    "Loan repaid",
    "New loan approved",
    "Payment received",
    "",
    "",
  ];

  return months.map((month, index) => ({
    date: month,
    score: 650 + Math.floor(Math.random() * 150) + index * 5,
    event: events[Math.floor(Math.random() * events.length)],
  }));
};

const generateMockYieldData = (): YieldDataPoint[] => {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  return months.map((month, index) => ({
    date: month,
    earnings: 100 + Math.random() * 200 + index * 10,
    apy: 8 + Math.random() * 6,
    principal: 5000 + index * 500,
  }));
};

export function FinancialPerformanceDashboard({
  userId,
  userType = "both",
}: FinancialPerformanceDashboardProps) {
  const [useMockData, setUseMockData] = useState(true);

  // Fetch real data from API
  const {
    data: creditScoreData,
    isLoading: isLoadingScore,
    error: scoreError,
    refetch: refetchScore,
  } = useCreditScoreHistory(userId, {
    enabled: !useMockData && (userType === "borrower" || userType === "both"),
  });

  const {
    data: yieldData,
    isLoading: isLoadingYield,
    error: yieldError,
    refetch: refetchYield,
  } = useYieldHistory(userId, {
    enabled: !useMockData && (userType === "lender" || userType === "both"),
  });

  // Use mock data or real data
  const displayCreditScoreData = useMockData
    ? generateMockCreditScoreData()
    : creditScoreData || [];

  const displayYieldData = useMockData ? generateMockYieldData() : yieldData || [];

  const handleRefresh = () => {
    if (!useMockData) {
      refetchScore();
      refetchYield();
    } else {
      // Force re-render with new mock data
      setUseMockData(false);
      setTimeout(() => setUseMockData(true), 100);
    }
  };

  const showCreditScore = userType === "borrower" || userType === "both";
  const showYield = userType === "lender" || userType === "both";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-zinc-100">
            Financial Performance
          </h2>
          <p className="text-sm text-gray-600 dark:text-zinc-400 mt-1">
            Track your{" "}
            {userType === "both"
              ? "credit score and yield"
              : userType === "borrower"
                ? "credit score"
                : "yield"}{" "}
            performance over time
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          className="flex items-center gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Demo mode indicator */}
      {useMockData && (
        <Card className="bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900 p-4">
          <p className="text-sm text-blue-900 dark:text-blue-300">
            📊 <strong>Demo Mode:</strong> Displaying sample data for visualization. Connect to
            backend API to see real historical data.
          </p>
        </Card>
      )}

      {/* Charts Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Credit Score Chart */}
        {showCreditScore && (
          <div className="lg:col-span-2">
            {isLoadingScore && !useMockData ? (
              <SkeletonChart />
            ) : scoreError && !useMockData ? (
              <Card className="p-8">
                <div className="text-center">
                  <p className="text-red-600 mb-4">Error loading credit score data</p>
                  <Button onClick={() => refetchScore()}>Retry</Button>
                </div>
              </Card>
            ) : (
              <CreditScoreTrendChart data={displayCreditScoreData} />
            )}
          </div>
        )}

        {/* Yield Earnings Chart */}
        {showYield && (
          <div className="lg:col-span-2">
            {isLoadingYield && !useMockData ? (
              <SkeletonChart />
            ) : yieldError && !useMockData ? (
              <Card className="p-8">
                <div className="text-center">
                  <p className="text-red-600 mb-4">Error loading yield data</p>
                  <Button onClick={() => refetchYield()}>Retry</Button>
                </div>
              </Card>
            ) : (
              <YieldEarningsChart data={displayYieldData} />
            )}
          </div>
        )}
      </div>

      {/* Insights Section */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {showCreditScore && (
          <Card className="p-6 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/30 dark:to-blue-900/20">
            <h3 className="text-sm font-medium text-blue-900 dark:text-blue-300 mb-2">
              Credit Score Insight
            </h3>
            <p className="text-xs text-blue-700 dark:text-blue-400">
              {displayCreditScoreData.length > 0 &&
              displayCreditScoreData[displayCreditScoreData.length - 1].score >= 750
                ? "Excellent! Your score qualifies you for premium loan rates."
                : "Keep making on-time payments to improve your score."}
            </p>
          </Card>
        )}

        {showYield && (
          <Card className="p-6 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950/30 dark:to-green-900/20">
            <h3 className="text-sm font-medium text-green-900 dark:text-green-300 mb-2">
              Yield Performance
            </h3>
            <p className="text-xs text-green-700 dark:text-green-400">
              Your portfolio is generating consistent returns. Consider diversifying for optimal
              yield.
            </p>
          </Card>
        )}

        <Card className="p-6 bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950/30 dark:to-purple-900/20">
          <h3 className="text-sm font-medium text-purple-900 dark:text-purple-300 mb-2">
            Next Steps
          </h3>
          <p className="text-xs text-purple-700 dark:text-purple-400">
            {userType === "borrower"
              ? "Apply for a new loan to leverage your improved credit score."
              : "Increase your lending pool to maximize earnings potential."}
          </p>
        </Card>
      </div>
    </div>
  );
}
