"use client";

import dynamic from "next/dynamic";
import { Suspense, useState, useMemo } from "react";
import type { CreditScoreDataPoint } from "../charts/CreditScoreTrendChart";
import type { YieldDataPoint } from "../charts/YieldEarningsChart";
import type { RiskTierDataPoint } from "../charts/RiskTierChart";

const CreditScoreTrendChart = dynamic(
  () => import("../charts/CreditScoreTrendChart").then((m) => m.CreditScoreTrendChart),
  { ssr: false, loading: () => <SkeletonChart /> },
);

const YieldEarningsChart = dynamic(
  () => import("../charts/YieldEarningsChart").then((m) => m.YieldEarningsChart),
  { ssr: false, loading: () => <SkeletonChart /> },
);

const RiskTierChart = dynamic(
  () => import("../charts/RiskTierChart").then((m) => m.RiskTierChart),
  { ssr: false, loading: () => <SkeletonChart /> },
);

import {
  useCreditScoreHistory,
  useYieldHistory,
  useLoans,
  usePoolStats,
  useDepositorPortfolio,
} from "@/app/hooks/useApi";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card";
import { Button } from "../ui/Button";
import { AnalyticsSkeleton } from "../skeletons/AnalyticsSkeleton";
import { SkeletonChart } from "../ui/Skeleton";
import { RefreshCw, CheckCircle2, TrendingUp, DollarSign, Activity } from "lucide-react";

interface FinancialPerformanceDashboardProps {
  userId: string;
  userType?: "borrower" | "lender" | "both";
  walletAddress?: string;
}

// ─── Mock data generators ──────────────────────────────────────────────────────

const generateMockCreditScoreData = (): CreditScoreDataPoint[] => {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const events = ["On-time payment", "Loan repaid", "New loan approved", "Payment received", "", ""];

  return months.map((month, index) => ({
    date: month,
    score: 650 + Math.floor(Math.random() * 150) + index * 5,
    event: events[Math.floor(Math.random() * events.length)],
  }));
};

const generateMockYieldData = (): YieldDataPoint[] => {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return months.map((month, index) => ({
    date: month,
    earnings: 100 + Math.random() * 200 + index * 10,
    apy: 8 + Math.random() * 6,
    principal: 5000 + index * 500,
  }));
};

const generateMockLoanStats = () => ({
  total: 8,
  approved: 7,
  repaid: 5,
  active: 2,
  defaulted: 1,
  onTimeRate: 80,
});

const generateMockDepositorStats = () => ({
  depositAmount: 12500,
  currentValue: 13250,
  yieldEarned: 750,
  apy: 8.5,
  utilizationRate: 72,
});

const generateMockRiskTierData = (): RiskTierDataPoint[] => [
  { tier: "Low", count: 8, color: "#10b981" },
  { tier: "Medium", count: 5, color: "#f59e0b" },
  { tier: "High", count: 2, color: "#ef4444" },
];

// ─── Score improvement actions ─────────────────────────────────────────────────

function getScoreImprovementActions(score: number): string[] {
  if (score >= 750) {
    return [
      "Maintain your on-time payment streak to keep an excellent score.",
      "Consider applying for larger loan amounts to leverage your high score.",
      "Your score qualifies for the lowest available interest rates.",
    ];
  }
  if (score >= 670) {
    return [
      "Pay all upcoming instalments on time to boost your score by 20–40 pts.",
      "Reduce outstanding loan balance below 30% of your credit limit.",
      "Avoid requesting new loans for at least 60 days.",
    ];
  }
  return [
    "Repay any overdue amounts immediately to stop score decline.",
    "Keep loan utilisation below 30% of your approved limit.",
    "Build a consistent 6-month on-time payment history.",
  ];
}

// ─── Stat card helper ──────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  sub,
  colorClass,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  sub?: string;
  colorClass: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className={`rounded-xl p-4 ${colorClass}`}>
      <div className="flex items-center gap-2 mb-1">
        {Icon && <Icon className="h-4 w-4 opacity-70" />}
        <p className="text-xs font-medium opacity-80">{title}</p>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function FinancialPerformanceDashboard({
  userId,
  userType = "both",
  walletAddress,
}: FinancialPerformanceDashboardProps) {
  const [useMockData, setUseMockData] = useState(true);

  // ── Existing chart data hooks ──
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

  // ── New: borrower data ──
  const { data: loans = [] } = useLoans({
    enabled: !useMockData && (userType === "borrower" || userType === "both"),
  });

  // ── New: lender data ──
  const { data: poolStats } = usePoolStats({
    enabled: !useMockData && (userType === "lender" || userType === "both"),
  });
  const { data: depositorPortfolio } = useDepositorPortfolio(walletAddress, {
    enabled: !useMockData && !!walletAddress && (userType === "lender" || userType === "both"),
  });

  // ── Derived display data ──
  const displayCreditScoreData = useMockData ? generateMockCreditScoreData() : (creditScoreData ?? []);
  const displayYieldData = useMockData ? generateMockYieldData() : (yieldData ?? []);

  const displayLoanStats = useMemo(() => {
    if (useMockData) return generateMockLoanStats();
    const total = loans.length;
    const repaid = loans.filter((l) => l.status === "repaid").length;
    const active = loans.filter((l) => l.status === "active").length;
    const defaulted = loans.filter((l) => l.status === "defaulted").length;
    const liquidated = loans.filter((l) => l.status === "liquidated").length;
    const approved = loans.filter((l) => l.status !== "pending").length;
    const resolved = repaid + defaulted + liquidated;
    const onTimeRate = resolved > 0 ? Math.round((repaid / resolved) * 100) : 0;
    return { total, approved, repaid, active, defaulted, onTimeRate };
  }, [useMockData, loans]);

  const displayDepositorStats = useMemo(() => {
    if (useMockData) return generateMockDepositorStats();
    return {
      depositAmount: depositorPortfolio?.depositAmount ?? 0,
      currentValue: depositorPortfolio
        ? depositorPortfolio.depositAmount + depositorPortfolio.estimatedYield
        : 0,
      yieldEarned: depositorPortfolio?.estimatedYield ?? 0,
      apy: depositorPortfolio?.apy ?? poolStats?.apy ?? 0,
      utilizationRate: poolStats?.utilizationRate ?? 0,
    };
  }, [useMockData, depositorPortfolio, poolStats]);

  const displayRiskTierData = useMemo((): RiskTierDataPoint[] => {
    if (useMockData) return generateMockRiskTierData();
    const activeLoans = loans.filter((l) => l.status === "active");
    return [
      { tier: "Low", count: activeLoans.filter((l) => l.interestRate < 5).length, color: "#10b981" },
      { tier: "Medium", count: activeLoans.filter((l) => l.interestRate >= 5 && l.interestRate < 10).length, color: "#f59e0b" },
      { tier: "High", count: activeLoans.filter((l) => l.interestRate >= 10).length, color: "#ef4444" },
    ];
  }, [useMockData, loans]);

  const currentScore = displayCreditScoreData[displayCreditScoreData.length - 1]?.score ?? 0;
  const improvementActions = getScoreImprovementActions(currentScore);

  const showCreditScore = userType === "borrower" || userType === "both";
  const showYield = userType === "lender" || userType === "both";

  const handleRefresh = () => {
    if (!useMockData) {
      refetchScore();
      refetchYield();
    } else {
      setUseMockData(false);
      setTimeout(() => setUseMockData(true), 100);
    }
  };

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

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
        <Button variant="outline" size="sm" onClick={handleRefresh} className="flex items-center gap-2">
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

      {/* ── Borrower section ── */}
      {showCreditScore && (
        <div className="space-y-6">
          {/* Loan history stats */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              title="Total Loans"
              value={displayLoanStats.total}
              colorClass="bg-indigo-50 text-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200"
              icon={Activity}
            />
            <StatCard
              title="Active"
              value={displayLoanStats.active}
              colorClass="bg-blue-50 text-blue-900 dark:bg-blue-950/30 dark:text-blue-200"
              icon={TrendingUp}
            />
            <StatCard
              title="Repaid"
              value={displayLoanStats.repaid}
              colorClass="bg-green-50 text-green-900 dark:bg-green-950/30 dark:text-green-200"
              icon={CheckCircle2}
            />
            <StatCard
              title="On-time Rate"
              value={`${displayLoanStats.onTimeRate}%`}
              sub={`${displayLoanStats.repaid} of ${displayLoanStats.repaid + displayLoanStats.defaulted} resolved`}
              colorClass="bg-purple-50 text-purple-900 dark:bg-purple-950/30 dark:text-purple-200"
            />
          </div>

          {/* Credit score chart */}
          {isLoadingScore && !useMockData ? (
            <AnalyticsSkeleton />
          ) : scoreError && !useMockData ? (
            <Card className="p-8">
              <div className="text-center">
                <p className="text-red-600 mb-4">Error loading credit score data</p>
                <Button onClick={() => refetchScore()}>Retry</Button>
              </div>
            </Card>
          ) : (
            <Suspense fallback={<SkeletonChart />}>
              <CreditScoreTrendChart data={displayCreditScoreData} />
            </Suspense>
          )}

          {/* Score improvement actions */}
          <Card>
            <CardHeader>
              <CardTitle>Next Steps to Improve Your Score</CardTitle>
              <p className="text-sm text-gray-600 dark:text-zinc-400 mt-1">
                Based on your current score of <strong>{currentScore}</strong>
              </p>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {improvementActions.map((action, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span className="h-5 w-5 rounded-full bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                        {i + 1}
                      </span>
                    </span>
                    <span className="text-zinc-700 dark:text-zinc-300">{action}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Lender section ── */}
      {showYield && (
        <div className="space-y-6">
          {/* Depositor stats */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              title="Total Deposited"
              value={fmt(displayDepositorStats.depositAmount)}
              colorClass="bg-green-50 text-green-900 dark:bg-green-950/30 dark:text-green-200"
              icon={DollarSign}
            />
            <StatCard
              title="Current Value"
              value={fmt(displayDepositorStats.currentValue)}
              sub={
                displayDepositorStats.depositAmount > 0
                  ? `+${(((displayDepositorStats.currentValue - displayDepositorStats.depositAmount) / displayDepositorStats.depositAmount) * 100).toFixed(2)}% growth`
                  : undefined
              }
              colorClass="bg-blue-50 text-blue-900 dark:bg-blue-950/30 dark:text-blue-200"
              icon={TrendingUp}
            />
            <StatCard
              title="Yield Earned"
              value={fmt(displayDepositorStats.yieldEarned)}
              sub={`${displayDepositorStats.apy.toFixed(2)}% APY`}
              colorClass="bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
              icon={Activity}
            />
          </div>

          {/* Pool utilisation */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard
              title="Pool Utilisation"
              value={`${displayDepositorStats.utilizationRate.toFixed(1)}%`}
              sub="Percentage of pool currently lent out"
              colorClass="bg-indigo-50 text-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200"
            />
            <StatCard
              title="Current APY"
              value={`${displayDepositorStats.apy.toFixed(2)}%`}
              sub="Annual percentage yield on your deposits"
              colorClass="bg-purple-50 text-purple-900 dark:bg-purple-950/30 dark:text-purple-200"
            />
          </div>

          {/* Yield chart */}
          {isLoadingYield && !useMockData ? (
            <AnalyticsSkeleton />
          ) : yieldError && !useMockData ? (
            <Card className="p-8">
              <div className="text-center">
                <p className="text-red-600 mb-4">Error loading yield data</p>
                <Button onClick={() => refetchYield()}>Retry</Button>
              </div>
            </Card>
          ) : (
            <Suspense fallback={<SkeletonChart />}>
              <YieldEarningsChart data={displayYieldData} />
            </Suspense>
          )}

          {/* Active loan risk tier breakdown */}
          <Suspense fallback={<SkeletonChart />}>
            <RiskTierChart data={displayRiskTierData} />
          </Suspense>
        </div>
      )}

      {/* ── Insights section (unchanged) ── */}
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
