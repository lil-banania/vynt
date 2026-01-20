"use client";

import { AlertTriangle, Clock, Calendar } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PriorityTier } from "@/lib/audit/prioritization";
import { formatCurrency, formatCustomerDisplay } from "@/lib/audit/calculations";

interface RecoveryPriorityMatrixProps {
  tiers: PriorityTier[];
}

const tierConfig = {
  high: {
    icon: AlertTriangle,
    emoji: "🔴",
    bgColor: "bg-rose-50",
    borderColor: "border-rose-200",
    textColor: "text-rose-700",
    badgeColor: "bg-rose-100 text-rose-800",
  },
  medium: {
    icon: Clock,
    emoji: "🟡",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-200",
    textColor: "text-amber-700",
    badgeColor: "bg-amber-100 text-amber-800",
  },
  low: {
    icon: Calendar,
    emoji: "🟢",
    bgColor: "bg-emerald-50",
    borderColor: "border-emerald-200",
    textColor: "text-emerald-700",
    badgeColor: "bg-emerald-100 text-emerald-800",
  },
};

const RecoveryPriorityMatrix = ({ tiers }: RecoveryPriorityMatrixProps) => {
  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-bold text-slate-900">
          Recovery Priority Matrix
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {tiers.map((tier) => {
          const config = tierConfig[tier.level];
          const topAnomalies = tier.anomalies.slice(0, 3);
          const remainingCount = tier.anomalies.length - 3;

          return (
            <div
              key={tier.level}
              className={`rounded-lg border p-4 ${config.bgColor} ${config.borderColor}`}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span>{config.emoji}</span>
                  <span className={`font-semibold ${config.textColor}`}>
                    {tier.label}
                  </span>
                  <span className="text-sm text-slate-500">
                    ({tier.timeframe})
                  </span>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${config.badgeColor}`}>
                  {tier.anomalies.length} issues
                </span>
              </div>

              {tier.anomalies.length > 0 ? (
                <>
                  <div className="space-y-2">
                    {topAnomalies.map((anomaly, idx) => (
                      <div
                        key={anomaly.id || idx}
                        className="flex items-center justify-between text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400">•</span>
                          <span className="font-medium text-slate-700">
                            {formatCustomerDisplay(
                              anomaly.customer_id,
                              (anomaly as Record<string, unknown>).customer_name as string | undefined,
                              (anomaly as Record<string, unknown>).customer_tier as string | undefined
                            )}
                          </span>
                          <span className="text-slate-500">
                            - {anomaly.category.replace(/_/g, " ")}
                          </span>
                        </div>
                        <span className="font-semibold text-slate-900">
                          {formatCurrency(anomaly.annual_impact)}/yr
                        </span>
                      </div>
                    ))}
                  </div>

                  {remainingCount > 0 && (
                    <p className="mt-2 text-xs text-slate-500">
                      + {remainingCount} more {remainingCount === 1 ? "issue" : "issues"}
                    </p>
                  )}

                  <div className="mt-3 border-t border-slate-200 pt-2">
                    <p className="text-sm font-medium text-slate-700">
                      Total: {formatCurrency(tier.totalImpact)}{" "}
                      <span className="text-slate-500">
                        ({tier.percentageOfTotal.toFixed(0)}% of total leakage)
                      </span>
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-500 italic">
                  No issues in this priority level
                </p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default RecoveryPriorityMatrix;
