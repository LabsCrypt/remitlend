"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card";
import { DollarSign, TrendingUp } from "lucide-react";

export interface YieldDataPoint {
  date: string;
  earnings: number;
  apy: number;
  principal?: number;
}

interface YieldEarningsChartProps {
  data: YieldDataPoint[];
  className?: string;
}

export function YieldEarningsChart({ data, className }: YieldEarningsChartProps) {
  // Calculate total earnings
  const totalEarnings = data.reduce((sum, point) => sum + point.earnings, 0);
  const avgAPY =
    data.length > 0
      ? (data.reduce((sum, point) => sum + point.apy, 0) / data.length).toFixed(2)
      : "0.00";

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">{data.date}</p>
          <div className="mt-2 space-y-1">
            <p className="text-sm text-gray-600 dark:text-zinc-400">
              Earnings:{" "}
              <span className="font-bold text-green-600 dark:text-green-400">
                ${data.earnings.toFixed(2)}
              </span>
            </p>
            <p className="text-sm text-gray-600 dark:text-zinc-400">
              APY:{" "}
              <span className="font-bold text-blue-600 dark:text-blue-400">
                {data.apy.toFixed(2)}%
              </span>
            </p>
            {data.principal && (
              <p className="text-xs text-gray-500 dark:text-zinc-500 mt-1">
                Principal: ${data.principal.toFixed(2)}
              </p>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  // Format currency
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Yield Earnings</CardTitle>
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-green-600 dark:text-green-400" />
            <span className="text-sm font-semibold text-green-600 dark:text-green-400">
              {formatCurrency(totalEarnings)}
            </span>
          </div>
        </div>
        <p className="text-sm text-gray-600 dark:text-zinc-400 mt-1">
          Historical yield performance • Avg APY: {avgAPY}%
        </p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="colorEarnings" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="colorAPY" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-zinc-800" />
            <XAxis
              dataKey="date"
              className="text-xs text-gray-600 dark:text-zinc-400"
              tick={{ fill: "currentColor" }}
              tickLine={{ stroke: "currentColor" }}
            />
            <YAxis
              yAxisId="left"
              className="text-xs text-gray-600 dark:text-zinc-400"
              tick={{ fill: "currentColor" }}
              tickLine={{ stroke: "currentColor" }}
              label={{
                value: "Earnings ($)",
                angle: -90,
                position: "insideLeft",
                className: "text-xs text-gray-600 dark:text-zinc-400",
              }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              className="text-xs text-gray-600 dark:text-zinc-400"
              tick={{ fill: "currentColor" }}
              tickLine={{ stroke: "currentColor" }}
              label={{
                value: "APY (%)",
                angle: 90,
                position: "insideRight",
                className: "text-xs text-gray-600 dark:text-zinc-400",
              }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{
                paddingTop: "20px",
              }}
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="earnings"
              stroke="#10b981"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorEarnings)"
              name="Earnings ($)"
            />
            <Area
              yAxisId="right"
              type="monotone"
              dataKey="apy"
              stroke="#3b82f6"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorAPY)"
              name="APY (%)"
            />
          </AreaChart>
        </ResponsiveContainer>

        {/* Summary stats */}
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="rounded-lg bg-green-50 p-4 dark:bg-green-950/30">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
              <p className="text-xs font-medium text-green-900 dark:text-green-300">
                Total Earnings
              </p>
            </div>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              {formatCurrency(totalEarnings)}
            </p>
          </div>

          <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-950/30">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <p className="text-xs font-medium text-blue-900 dark:text-blue-300">Average APY</p>
            </div>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{avgAPY}%</p>
          </div>

          <div className="rounded-lg bg-purple-50 p-4 dark:bg-purple-950/30">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              <p className="text-xs font-medium text-purple-900 dark:text-purple-300">
                Data Points
              </p>
            </div>
            <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{data.length}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
