"use client";

import { X } from "lucide-react";
import { Anomaly } from "@/lib/types/database";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { categoryConfig, formatCurrency } from "@/lib/utils/category-config";

type AnomalySidePanelProps = {
  anomaly: Anomaly | null;
  open: boolean;
  onClose: () => void;
};

export function AnomalySidePanel({ anomaly, open, onClose }: AnomalySidePanelProps) {
  if (!open || !anomaly) return null;

  const config = categoryConfig[anomaly.category] || categoryConfig.other;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/20 z-40 transition-opacity"
        onClick={onClose}
      />
      
      {/* Side Panel - 600px max width, no scroll needed */}
      <div className="fixed right-0 top-0 bottom-0 w-[600px] bg-white shadow-2xl z-50 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-[#E7E5E4] px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-medium text-[#1C1917]">Anomaly Details</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Content - Compact spacing */}
        <div className="px-6 py-4 space-y-4">
          {/* Category Badge */}
          <div>
            <Badge className={`${config.badgeClass} border-transparent`}>
              {config.label}
            </Badge>
          </div>

          {/* Confidence */}
          <div>
            <p className="text-sm font-medium text-[#78716C] mb-1">Confidence Level</p>
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
              {anomaly.confidence} confidence
            </Badge>
          </div>

          {/* Description */}
          <div>
            <p className="text-sm font-medium text-[#78716C] mb-1">Description</p>
            <p className="text-sm text-[#1C1917] leading-relaxed">
              {anomaly.description ?? "No description available"}
            </p>
          </div>

          {/* Financial Impact */}
          <div className="rounded-lg border border-[#E7E5E4] p-3">
            <p className="text-xs text-[#78716C]">Annual Impact</p>
            <p className="mt-1 text-2xl font-semibold text-[#DC2626]">
              {formatCurrency(anomaly.annual_impact)}
            </p>
          </div>

          {/* Root Cause */}
          <div>
            <p className="text-sm font-medium text-[#78716C] mb-1">Root Cause</p>
            <div className="rounded-lg bg-slate-50 border border-[#E7E5E4] p-3">
              <p className="text-sm text-[#1C1917] leading-relaxed">
                {anomaly.root_cause ?? "Analysis pending"}
              </p>
            </div>
          </div>

          {/* Recommendation */}
          <div>
            <p className="text-sm font-medium text-[#78716C] mb-1">Recommendation</p>
            <div className="rounded-lg bg-slate-50 border border-[#E7E5E4] p-3">
              <p className="text-sm text-[#1C1917] leading-relaxed">
                {anomaly.recommendation ?? "Review required"}
              </p>
            </div>
          </div>

          {/* Customer Info */}
          {anomaly.customer_id && (
            <div>
              <p className="text-sm font-medium text-[#78716C] mb-1">Customer ID</p>
              <p className="text-sm font-mono text-[#1C1917]">
                {anomaly.customer_id}
              </p>
            </div>
          )}

          {/* Metadata */}
          {anomaly.metadata && Object.keys(anomaly.metadata).length > 0 && (
            <div>
              <p className="text-sm font-medium text-[#78716C] mb-1">Additional Details</p>
              <div className="rounded-lg bg-slate-50 border border-[#E7E5E4] p-3">
                <pre className="text-xs text-[#1C1917] whitespace-pre-wrap font-mono">
                  {JSON.stringify(anomaly.metadata, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button className="flex-1" variant="default" size="sm">
              Mark as Resolved
            </Button>
            <Button className="flex-1" variant="outline" size="sm">
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
