"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Anomaly } from "@/lib/types/database";
import { AnomalySidePanel } from "./AnomalySidePanel";

type NeedsActionLayoutProps = {
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

const categoryConfig: Record<string, { label: string; color: string }> = {
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

export function NeedsActionLayout({ anomalies }: NeedsActionLayoutProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedAnomaly, setSelectedAnomaly] = useState<Anomaly | null>(null);

  // Sort by annual impact and take top 10
  const sortedAnomalies = [...anomalies]
    .sort((a, b) => (b.annual_impact ?? 0) - (a.annual_impact ?? 0))
    .slice(0, 10);

  // Top 5 issues by impact
  const topIssues = sortedAnomalies.slice(0, 5);

  // Analyze common patterns by category
  const categoryGroups = sortedAnomalies.reduce((acc, anomaly) => {
    const cat = anomaly.category;
    if (!acc[cat]) {
      acc[cat] = { count: 0, totalImpact: 0, anomalies: [] };
    }
    acc[cat].count++;
    acc[cat].totalImpact += anomaly.annual_impact ?? 0;
    acc[cat].anomalies.push(anomaly);
    return acc;
  }, {} as Record<string, { count: number; totalImpact: number; anomalies: Anomaly[] }>);

  const commonPatterns = Object.entries(categoryGroups)
    .map(([category, data]) => ({
      category,
      count: data.count,
      totalImpact: data.totalImpact,
      avgImpact: data.totalImpact / data.count,
    }))
    .sort((a, b) => b.totalImpact - a.totalImpact)
    .slice(0, 5);

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedIds);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedIds(newExpanded);
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-6">
        {/* Left Column: Top Issues */}
        <Card className="border-[#E7E5E4]">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-[#1C1917]">
              Top Issues by Impact
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topIssues.map((anomaly, index) => {
                const isExpanded = expandedIds.has(anomaly.id);
                
                return (
                  <div key={anomaly.id} className="rounded-lg border border-[#E7E5E4] transition-colors hover:bg-slate-50">
                    {/* Main row */}
                    <div className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-4 flex-1">
                        <button
                          onClick={() => toggleExpand(anomaly.id)}
                          className="flex items-center justify-center w-5 h-5 text-[#78716C] hover:text-[#1C1917]"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>

                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-[#1C1917]">
                              #{index + 1}
                            </span>
                            <Badge
                              variant="outline"
                              className={`border text-xs ${categoryConfig[anomaly.category]?.color ?? categoryConfig.other.color}`}
                            >
                              {categoryConfig[anomaly.category]?.label ?? categoryConfig.other.label}
                            </Badge>
                          </div>
                          <p className="text-xs text-[#78716C] line-clamp-1">
                            {anomaly.description ?? "Anomaly detected"}
                          </p>
                        </div>

                        <div className="text-right">
                          <p className="text-base font-semibold text-[#DC2626]">
                            {formatCurrency(anomaly.annual_impact)}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-[#E7E5E4] pt-3">
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <p className="text-xs text-[#78716C] mb-1">Root Cause</p>
                              <p className="text-xs text-[#1C1917]">
                                {anomaly.root_cause ?? "Analysis pending"}
                              </p>
                            </div>
                            <div>
                              <p className="text-xs text-[#78716C] mb-1">Recommendation</p>
                              <p className="text-xs text-[#1C1917]">
                                {anomaly.recommendation ?? "Review required"}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => setSelectedAnomaly(anomaly)}
                            className="text-xs font-medium text-[#FA6400] hover:text-[#E65A00]"
                          >
                            View Full Details →
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Right Column: Common Patterns */}
        <Card className="border-[#E7E5E4]">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-[#1C1917]">
              Common Patterns Observed
            </CardTitle>
            <p className="text-xs text-[#78716C] mt-1">
              AI-analyzed patterns across your anomalies
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {commonPatterns.map((pattern) => (
                <div
                  key={pattern.category}
                  className="rounded-lg border border-[#E7E5E4] p-4"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge
                          variant="outline"
                          className={`border ${categoryConfig[pattern.category]?.color ?? categoryConfig.other.color}`}
                        >
                          {categoryConfig[pattern.category]?.label ?? categoryConfig.other.label}
                        </Badge>
                        <span className="text-xs text-[#78716C]">
                          {pattern.count} occurrence{pattern.count > 1 ? "s" : ""}
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <p className="text-[#78716C]">Total Impact</p>
                          <p className="font-semibold text-[#DC2626]">
                            {formatCurrency(pattern.totalImpact)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[#78716C]">Avg. Impact</p>
                          <p className="font-semibold text-[#1C1917]">
                            {formatCurrency(pattern.avgImpact)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* AI Analysis placeholder */}
                  <div className="rounded bg-slate-50 p-3 mt-3">
                    <p className="text-xs text-[#78716C] italic">
                      Pattern: This category shows {pattern.count > 3 ? "high" : "moderate"} frequency 
                      with {pattern.totalImpact > 10000 ? "significant" : "notable"} financial impact. 
                      {pattern.count > 2 && " Recommend immediate review and systematic correction."}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <AnomalySidePanel
        anomaly={selectedAnomaly}
        open={!!selectedAnomaly}
        onClose={() => setSelectedAnomaly(null)}
      />
    </>
  );
}
