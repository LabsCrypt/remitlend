"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card";
import { TrendingUp, TrendingDown } from "lucide-react";

export interface CreditScoreDataPoint {
  date: string;
  score: number;
  event?: string;
}

interface CreditScoreTrendChartProps {
  data: CreditScoreDataPoint[];
  className?: string;
}

export function CreditScoreTrendChart({ data, className }: CreditScoreTrendChartProps) {
  // Calculate trend
  const firstScore = data[0]?.score || 0;
  const lastScore = data[data.length - 1]?.score || 0;
  const scoreDiff = lastScore - firstScore;
  const percentChange = firstScore > 0 ? ((scoreDiff / firstScore) * 100).toFixed(1) : "0.0";
  const isPositive = scoreDiff >= 0;

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">{data.date}</p>
          <p className="text-lg font-bold text-blue-600 dark:text-blue-400">Score: {data.score}</p>
          {data.event && (
            <p className="text-xs text-gray-600 dark:text-zinc-400 mt-1">{data.event}</p>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Credit Score Trend</CardTitle>
          <div className="flex items-center gap-2">
            {isPositive ? (
              <TrendingUp className="h-5 w-5 text-green-600 dark:text-green-400" />
            ) : (
              <TrendingDown className="h-5 w-5 text-red-600 dark:text-red-400" />
            )}
            <span
              className={`text-sm font-semibold ${
                isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
              }`}
            >
              {isPositive ? "+" : ""}
              {percentChange}%
            </span>
          </div>
        </div>
        <p className="text-sm text-gray-600 dark:text-zinc-400 mt-1">
          Your credit score over the last {data.length} periods
        </p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-zinc-800" />
            <XAxis
              dataKey="date"
              className="text-xs text-gray-600 dark:text-zinc-400"
              tick={{ fill: "currentColor" }}
              tickLine={{ stroke: "currentColor" }}
            />
            <YAxis
              domain={[300, 850]}
              className="text-xs text-gray-600 dark:text-zinc-400"
              tick={{ fill: "currentColor" }}
              tickLine={{ stroke: "currentColor" }}
              label={{
                value: "Credit Score",
                angle: -90,
                position: "insideLeft",
                className: "text-xs text-gray-600 dark:text-zinc-400",
              }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{
                paddingTop: "20px",
              }}
              iconType="line"
            />
            <Line
              type="monotone"
              dataKey="score"
              stroke="#3b82f6"
              strokeWidth={3}
              dot={{
                fill: "#3b82f6",
                strokeWidth: 2,
                r: 4,
              }}
              activeDot={{
                r: 6,
                fill: "#2563eb",
              }}
              name="Credit Score"
            />
          </LineChart>
        </ResponsiveContainer>

        {/* Score bands reference */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Excellent", range: "750-850", color: "bg-green-500" },
            { label: "Good", range: "670-749", color: "bg-blue-500" },
            { label: "Fair", range: "580-669", color: "bg-yellow-500" },
            { label: "Poor", range: "300-579", color: "bg-red-500" },
          ].map((band) => (
            <div
              key={band.label}
              className="flex items-center gap-2 rounded-lg bg-gray-50 p-2 dark:bg-zinc-900"
            >
              <div className={`h-3 w-3 rounded-full ${band.color}`} />
              <div>
                <p className="text-xs font-medium text-gray-900 dark:text-zinc-100">{band.label}</p>
                <p className="text-xs text-gray-600 dark:text-zinc-400">{band.range}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
