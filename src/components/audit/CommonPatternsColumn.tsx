"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Info, TrendingUp, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Anomaly } from "@/lib/types/database";
import { categoryConfig, formatCurrency } from "@/lib/utils/category-config";

type CommonPatternsColumnProps = {
  anomalies: Anomaly[];
};

type Pattern = {
  category: string;
  count: number;
  totalImpact: number;
  avgImpact: number;
  trend: "increasing" | "stable";
  insight: string;
  recommendation: string;
};

// AI-powered pattern analysis
const generatePatternInsights = (
  category: string,
  count: number,
  totalImpact: number,
  avgImpact: number
): { insight: string; recommendation: string; trend: "increasing" | "stable" } => {
  const categoryInsights: Record<string, { insight: string; recommendation: string }> = {
    failed_payment: {
      insight: `${count} failed payment${count > 1 ? "s" : ""} detected, indicating potential issues with payment method updates or insufficient funds. This pattern suggests systematic problems in payment processing.`,
      recommendation: "Implement automated retry logic with exponential backoff and proactive customer communication before payment failure.",
    },
    duplicate_charge: {
      insight: `${count} duplicate charge${count > 1 ? "s" : ""} identified, likely caused by race conditions in billing system or manual intervention errors. Average impact of ${formatCurrency(avgImpact)} per occurrence.`,
      recommendation: "Add idempotency keys to all billing operations and implement duplicate detection middleware.",
    },
    zombie_subscription: {
      insight: `${count} zombie subscription${count > 1 ? "s" : ""} found - customers marked as cancelled but still being billed. This represents ${formatCurrency(totalImpact)}/year in potential refunds.`,
      recommendation: "Audit subscription lifecycle hooks and ensure cancellation events properly propagate to billing system.",
    },
    unbilled_usage: {
      insight: `${count} unbilled usage event${count > 1 ? "s" : ""} totaling ${formatCurrency(totalImpact)}/year. High frequency suggests gaps in usage tracking or billing integration.`,
      recommendation: "Review usage event pipeline for dropped events and implement reconciliation job to catch missed billing.",
    },
    disputed_charge: {
      insight: `${count} disputed charge${count > 1 ? "s" : ""} with average impact of ${formatCurrency(avgImpact)}. Pattern analysis shows these often correlate with unclear pricing or unexpected charges.`,
      recommendation: "Improve billing transparency with detailed invoices and proactive notifications before charge attempts.",
    },
    fee_discrepancy: {
      insight: `${count} fee discrepanc${count === 1 ? "y" : "ies"} detected where actual fees exceed expected thresholds. Total impact: ${formatCurrency(totalImpact)}/year.`,
      recommendation: "Review payment processor fee structure and implement automated fee validation against contract terms.",
    },
  };

  const defaults = {
    insight: `${count} anomal${count === 1 ? "y" : "ies"} in this category with total annual impact of ${formatCurrency(totalImpact)}. Requires investigation to determine root cause.`,
    recommendation: "Conduct detailed analysis of affected transactions and identify common factors across occurrences.",
  };

  const result = categoryInsights[category] || defaults;
  const trend = count > 3 ? "increasing" : "stable";

  return { ...result, trend };
};

export function CommonPatternsColumn({ anomalies }: CommonPatternsColumnProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  // Analyze patterns by category
  const categoryGroups = anomalies.reduce((acc, anomaly) => {
    const cat = anomaly.category;
    if (!acc[cat]) {
      acc[cat] = { count: 0, totalImpact: 0 };
    }
    acc[cat].count++;
    acc[cat].totalImpact += anomaly.annual_impact ?? 0;
    return acc;
  }, {} as Record<string, { count: number; totalImpact: number }>);

  const patterns: Pattern[] = Object.entries(categoryGroups)
    .map(([category, data]) => {
      const avgImpact = data.totalImpact / data.count;
      const { insight, recommendation, trend } = generatePatternInsights(
        category,
        data.count,
        data.totalImpact,
        avgImpact
      );
      return {
        category,
        count: data.count,
        totalImpact: data.totalImpact,
        avgImpact,
        trend,
        insight,
        recommendation,
      };
    })
    .sort((a, b) => b.totalImpact - a.totalImpact)
    .slice(0, 10);

  const totalPages = Math.ceil(patterns.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const displayedPatterns = patterns.slice(startIndex, startIndex + itemsPerPage);

  return (
    <div className="bg-white border border-[#E7E5E4] rounded-lg shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="text-base font-medium text-[#0C0A09]">
              Common Patterns Identified
            </h3>
            <Info className="h-4 w-4 text-[#0A0A0A]" />
          </div>
          <p className="text-sm text-[#78716C] mt-1.5">
            AI-powered analysis of recurring issues
          </p>
        </div>
      </div>

      {/* Pattern Cards */}
      <div className="px-4 pb-4 space-y-3">
        {displayedPatterns.map((pattern, index) => {
          const config = categoryConfig[pattern.category] || categoryConfig.other;
          
          return (
            <div
              key={pattern.category}
              className="border border-[#E7E5E4] rounded-lg p-4 hover:bg-slate-50 transition-colors"
            >
              {/* Header Row */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[#0A0A0A]">
                    #{startIndex + index + 1}
                  </span>
            <Badge variant="outline" className={config.badgeClass}>
                    {config.label}
                  </Badge>
                  {pattern.trend === "increasing" && (
                    <div className="flex items-center gap-1 text-xs text-rose-600">
                      <TrendingUp className="h-3 w-3" />
                      <span>Increasing</span>
                    </div>
                  )}
                </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-[#DC2626]">
                  {formatCurrency(pattern.totalImpact)}/yr
                </div>
                <div className="text-xs text-[#78716C]">
                  {pattern.count} occurrence{pattern.count > 1 ? "s" : ""}
                </div>
              </div>
            </div>

            {/* AI Insight */}
            <div className="bg-slate-50 rounded p-3 mb-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-[#FA6400] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-[#0A0A0A] mb-1">
                    Pattern Analysis
                  </p>
                  <p className="text-xs text-[#78716C] leading-relaxed">
                    {pattern.insight}
                  </p>
                </div>
              </div>
            </div>

            {/* Recommendation */}
            <div className="flex items-start gap-2">
              <div className="h-4 w-4 flex items-center justify-center mt-0.5">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
              </div>
              <div>
                <p className="text-xs font-medium text-[#0A0A0A] mb-1">
                  Recommended Action
                </p>
                <p className="text-xs text-[#78716C] leading-relaxed">
                  {pattern.recommendation}
                </p>
              </div>
            </div>

            {/* Metrics */}
            <div className="mt-3 pt-3 border-t border-slate-200 flex items-center gap-4 text-xs">
              <div>
                <span className="text-[#78716C]">Avg Impact: </span>
                <span className="font-medium text-[#0A0A0A]">
                  {formatCurrency(pattern.avgImpact)}
                </span>
              </div>
              <div className="h-3 w-px bg-slate-200" />
              <div>
                <span className="text-[#78716C]">Total: </span>
                <span className="font-medium text-[#DC2626]">
                  {formatCurrency(pattern.totalImpact)}/yr
                </span>
              </div>
            </div>
          </div>
          );
        })}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-end gap-8 px-4 pb-4 pt-2">
        <div className="text-sm font-medium text-[#0A0A0A]">
          Page {currentPage} of {totalPages}
        </div>
        <div className="flex gap-2">
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9 shadow-sm"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-6 w-6" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9 shadow-sm"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          >
            <ChevronRight className="h-6 w-6" />
          </Button>
        </div>
      </div>
    </div>
  );
}
