"use client";

import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Anomaly, AnomalyCategory } from "@/lib/types/database";

type ImpactChartProps = {
  anomalies: Anomaly[];
};

type CategoryDatum = {
  category: AnomalyCategory;
  label: string;
  color: string;
  impact: number;
  count: number;
};

const CATEGORY_CONFIG: Record<
  AnomalyCategory,
  { label: string; color: string }
> = {
  zombie_subscription: {
    label: "Zombie Subscription",
    color: "#f43f5e",
  },
  unbilled_usage: {
    label: "Unbilled Usage",
    color: "#f59e0b",
  },
  pricing_mismatch: {
    label: "Pricing Mismatch",
    color: "#a855f7",
  },
  duplicate_charge: {
    label: "Duplicate Charge",
    color: "#f97316",
  },
  failed_payment: {
    label: "Failed Payment",
    color: "#ef4444",
  },
  high_refund_rate: {
    label: "High Refund Rate",
    color: "#eab308",
  },
  missing_in_stripe: {
    label: "Missing in Stripe",
    color: "#3b82f6",
  },
  missing_in_db: {
    label: "Missing in DB",
    color: "#06b6d4",
  },
  amount_mismatch: {
    label: "Amount Mismatch",
    color: "#6366f1",
  },
  revenue_leakage: {
    label: "Revenue Leakage",
    color: "#ec4899",
  },
  other: {
    label: "Other",
    color: "#64748b",
  },
};

const ImpactChart = ({ anomalies }: ImpactChartProps) => {
  const grouped = anomalies.reduce<Record<string, CategoryDatum>>(
    (acc, anomaly) => {
      const config = CATEGORY_CONFIG[anomaly.category];
      if (!acc[anomaly.category]) {
        acc[anomaly.category] = {
          category: anomaly.category,
          label: config.label,
          color: config.color,
          impact: 0,
          count: 0,
        };
      }
      acc[anomaly.category].impact += anomaly.annual_impact ?? 0;
      acc[anomaly.category].count += 1;
      return acc;
    },
    {}
  );

  const data = Object.values(grouped);

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
        No anomaly data available.
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="h-[320px] rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-4 text-sm font-semibold text-slate-900">
          Impact by Category
        </div>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 16 }}>
            <XAxis
              type="number"
              tickFormatter={(value) =>
                value.toLocaleString("en-US", {
                  style: "currency",
                  currency: "USD",
                  maximumFractionDigits: 0,
                })
              }
              axisLine={false}
              tickLine={false}
              fontSize={12}
            />
            <YAxis
              dataKey="label"
              type="category"
              axisLine={false}
              tickLine={false}
              fontSize={12}
              width={130}
            />
            <Tooltip
              formatter={(value) => {
                if (typeof value !== "number") {
                  return value ?? "-";
                }
                return value.toLocaleString("en-US", {
                  style: "currency",
                  currency: "USD",
                  maximumFractionDigits: 0,
                });
              }}
            />
            <Bar dataKey="impact" radius={[0, 6, 6, 0]}>
              {data.map((entry) => (
                <Cell key={entry.category} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="h-[320px] rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-4 text-sm font-semibold text-slate-900">
          Anomalies by Category
        </div>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="label"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={2}
            >
              {data.map((entry) => (
                <Cell key={entry.category} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default ImpactChart;