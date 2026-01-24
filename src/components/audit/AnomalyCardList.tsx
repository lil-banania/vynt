"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Anomaly } from "@/lib/types/database";
import { AnomalyDetailDialog } from "./AnomalyDetailDialog";

type AnomalyCardListProps = {
  anomalies: Anomaly[];
};

const formatCurrency = (value: number | null) => {
  if (value === null) return "$0";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
};

const categoryConfig: Record<
  string,
  { label: string; color: string }
> = {
  failed_payment: {
    label: "Failed",
    color: "bg-orange-100 text-orange-700 border-orange-200",
  },
  duplicate_charge: {
    label: "Duplicate",
    color: "bg-blue-100 text-blue-700 border-blue-200",
  },
  zombie_subscription: {
    label: "Zombie",
    color: "bg-teal-100 text-teal-700 border-teal-200",
  },
  unbilled_usage: {
    label: "Unbilled",
    color: "bg-yellow-100 text-yellow-700 border-yellow-200",
  },
  disputed_charge: {
    label: "Disputed",
    color: "bg-green-100 text-green-700 border-green-200",
  },
  fee_discrepancy: {
    label: "Fee",
    color: "bg-purple-100 text-purple-700 border-purple-200",
  },
  pricing_mismatch: {
    label: "Pricing",
    color: "bg-pink-100 text-pink-700 border-pink-200",
  },
  other: {
    label: "Other",
    color: "bg-slate-100 text-slate-700 border-slate-200",
  },
};

export function AnomalyCardList({ anomalies }: AnomalyCardListProps) {
  const [selectedAnomaly, setSelectedAnomaly] = useState<Anomaly | null>(null);

  if (anomalies.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 py-12 text-sm text-slate-500">
        No anomalies found.
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        {anomalies.map((anomaly) => {
          // Format anomaly ID as #121
          const anomalyNumber = anomaly.id.slice(0, 3);
          
          return (
            <Card
              key={anomaly.id}
              className="border-slate-200 transition-shadow hover:shadow-lg cursor-pointer"
              onClick={() => setSelectedAnomaly(anomaly)}
            >
              <CardContent className="pt-6 space-y-4">
                {/* Top section: Category badge */}
                <div className="flex items-start justify-between">
                  <Badge
                    variant="outline"
                    className={`border ${categoryConfig[anomaly.category]?.color ?? categoryConfig.other.color}`}
                  >
                    {categoryConfig[anomaly.category]?.label ?? categoryConfig.other.label}
                  </Badge>
                </div>

                {/* Anomaly ID */}
                <div>
                  <p className="text-sm text-slate-500">Total anomalies</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">
                    #{anomalyNumber}
                  </p>
                </div>

                {/* Estimated Recovery */}
                <div>
                  <p className="text-sm text-slate-500">Estimated Recovered</p>
                  <p className="mt-1 text-2xl font-semibold text-emerald-600">
                    {formatCurrency((anomaly.annual_impact ?? 0) * 0.85)}
                  </p>
                </div>

                {/* Annual Impact */}
                <div>
                  <p className="text-sm text-slate-500">Annual Impact</p>
                  <p className="mt-1 text-2xl font-semibold text-rose-600">
                    {formatCurrency(anomaly.annual_impact)}
                  </p>
                </div>

                {/* Confidence Badge */}
                <div className="pt-2">
                  <Badge
                    variant={
                      anomaly.confidence === "high"
                        ? "default"
                        : anomaly.confidence === "medium"
                          ? "secondary"
                          : "outline"
                    }
                    className="text-xs"
                  >
                    {anomaly.confidence} confidence
                  </Badge>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <AnomalyDetailDialog
        anomaly={selectedAnomaly}
        open={!!selectedAnomaly}
        onOpenChange={(open) => !open && setSelectedAnomaly(null)}
      />
    </>
  );
}
