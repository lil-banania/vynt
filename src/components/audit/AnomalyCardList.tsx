"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Anomaly } from "@/lib/types/database";
import { AnomalySidePanel } from "./AnomalySidePanel";

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
    label: "Failed Payment",
    color: "bg-red-50 text-red-800 border-red-200",
  },
  duplicate_charge: {
    label: "Duplicate Charge",
    color: "bg-blue-50 text-blue-800 border-blue-200",
  },
  zombie_subscription: {
    label: "Zombie Subscription",
    color: "bg-teal-50 text-teal-800 border-teal-200",
  },
  unbilled_usage: {
    label: "Unbilled Usage",
    color: "bg-yellow-50 text-yellow-800 border-yellow-200",
  },
  disputed_charge: {
    label: "Disputed Charge",
    color: "bg-green-50 text-green-800 border-green-200",
  },
  fee_discrepancy: {
    label: "Fee Discrepancy",
    color: "bg-purple-50 text-purple-800 border-purple-200",
  },
  pricing_mismatch: {
    label: "Pricing Mismatch",
    color: "bg-pink-50 text-pink-800 border-pink-200",
  },
  other: {
    label: "Other",
    color: "bg-slate-50 text-slate-800 border-slate-200",
  },
};

export function AnomalyCardList({ anomalies }: AnomalyCardListProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedAnomaly, setSelectedAnomaly] = useState<Anomaly | null>(null);

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedIds);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedIds(newExpanded);
  };

  if (anomalies.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-[#E7E5E4] bg-slate-50 py-12 text-sm text-[#78716C]">
        No anomalies found.
      </div>
    );
  }

  return (
    <>
      <div className="rounded-lg border border-[#E7E5E4] bg-white divide-y divide-[#E7E5E4]">
        {anomalies.map((anomaly, index) => {
          const isExpanded = expandedIds.has(anomaly.id);
          const anomalyNumber = index + 1;
          
          return (
            <div key={anomaly.id} className="transition-colors hover:bg-slate-50">
              {/* Main row - always visible */}
              <div className="flex items-center justify-between px-6 py-5">
                <div className="flex items-center gap-6 flex-1">
                  {/* Expand button */}
                  <button
                    onClick={() => toggleExpand(anomaly.id)}
                    className="flex items-center justify-center w-6 h-6 text-[#78716C] hover:text-[#1C1917] transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-5 w-5" />
                    ) : (
                      <ChevronRight className="h-5 w-5" />
                    )}
                  </button>

                  {/* Anomaly info */}
                  <div className="flex items-center gap-4 flex-1">
                    <p className="text-base font-medium text-[#1C1917]">
                      #{anomalyNumber}
                    </p>
                    
                    <Badge
                      variant="outline"
                      className={`border ${categoryConfig[anomaly.category]?.color ?? categoryConfig.other.color}`}
                    >
                      {categoryConfig[anomaly.category]?.label ?? categoryConfig.other.label}
                    </Badge>

                    <p className="text-sm text-[#78716C] flex-1">
                      {anomaly.description ?? "Anomaly detected"}
                    </p>
                  </div>
                </div>

                {/* Impact */}
                <div className="text-right">
                  <p className="text-lg font-semibold text-[#DC2626]">
                    {formatCurrency(anomaly.annual_impact)}
                  </p>
                  <p className="text-xs text-[#78716C]">Annual Impact</p>
                </div>
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div className="px-6 pb-6 pt-0">
                  <div className="ml-12 space-y-4">
                    {/* Metrics Grid */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="rounded-lg border border-[#E7E5E4] bg-red-50 bg-opacity-50 p-4">
                        <p className="text-xs text-[#78716C] mb-1">Annual Impact</p>
                        <p className="text-2xl font-semibold text-[#DC2626]">
                          {formatCurrency(anomaly.annual_impact)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[#E7E5E4] bg-green-50 bg-opacity-50 p-4">
                        <p className="text-xs text-[#78716C] mb-1">Est. Recovered</p>
                        <p className="text-2xl font-semibold text-[#15803D]">
                          {formatCurrency((anomaly.annual_impact ?? 0) * 0.85)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[#E7E5E4] bg-slate-50 p-4">
                        <p className="text-xs text-[#78716C] mb-1">Confidence</p>
                        <Badge
                          variant={
                            anomaly.confidence === "high"
                              ? "default"
                              : anomaly.confidence === "medium"
                                ? "secondary"
                                : "outline"
                          }
                          className="text-sm"
                        >
                          {anomaly.confidence}
                        </Badge>
                      </div>
                    </div>

                    {/* Root Cause & Recommendation */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="rounded-lg bg-slate-50 border border-[#E7E5E4] p-4">
                        <p className="text-xs font-medium text-[#78716C] mb-2">Root Cause</p>
                        <p className="text-sm text-[#1C1917]">
                          {anomaly.root_cause ?? "Analysis pending"}
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-50 border border-[#E7E5E4] p-4">
                        <p className="text-xs font-medium text-[#78716C] mb-2">Recommendation</p>
                        <p className="text-sm text-[#1C1917]">
                          {anomaly.recommendation ?? "Review required"}
                        </p>
                      </div>
                    </div>

                    {/* Action button */}
                    <div>
                      <button
                        onClick={() => setSelectedAnomaly(anomaly)}
                        className="text-sm font-medium text-[#FA6400] hover:text-[#E65A00] transition-colors"
                      >
                        View Full Details →
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <AnomalySidePanel
        anomaly={selectedAnomaly}
        open={!!selectedAnomaly}
        onClose={() => setSelectedAnomaly(null)}
      />
    </>
  );
}
