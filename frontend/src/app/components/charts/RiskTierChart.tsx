"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card";

export interface RiskTierDataPoint {
  tier: string;
  count: number;
  color: string;
}

interface RiskTierChartProps {
  data: RiskTierDataPoint[];
  className?: string;
}

export function RiskTierChart({ data, className }: RiskTierChartProps) {
  const total = data.reduce((sum, d) => sum + d.count, 0);

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: { payload: RiskTierDataPoint }[];
  }) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      const pct = total > 0 ? ((d.count / total) * 100).toFixed(1) : "0.0";
      return (
        <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">{d.tier} Risk</p>
          <p className="text-lg font-bold" style={{ color: d.color }}>
            {d.count} loan{d.count !== 1 ? "s" : ""} ({pct}%)
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Active Loans by Risk Tier</CardTitle>
        <p className="text-sm text-gray-600 dark:text-zinc-400 mt-1">
          {total} active loan{total !== 1 ? "s" : ""} across risk categories
        </p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-zinc-800" />
            <XAxis
              dataKey="tier"
              tick={{ fill: "currentColor" }}
              tickLine={{ stroke: "currentColor" }}
              className="text-xs text-gray-600 dark:text-zinc-400"
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: "currentColor" }}
              tickLine={{ stroke: "currentColor" }}
              className="text-xs text-gray-600 dark:text-zinc-400"
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="count" radius={[4, 4, 0, 0]} name="Loans">
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        <div className="mt-4 flex items-center justify-center gap-6">
          {data.map((d) => (
            <div key={d.tier} className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full" style={{ backgroundColor: d.color }} />
              <span className="text-xs text-gray-600 dark:text-zinc-400">
                {d.tier}: {d.count}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
