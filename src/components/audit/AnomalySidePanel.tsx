"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Anomaly } from "@/lib/types/database";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type AnomalySidePanelProps = {
  anomaly: Anomaly | null;
  open: boolean;
  onClose: () => void;
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
    color: "bg-orange-100 text-orange-800 border-orange-200",
  },
  duplicate_charge: {
    label: "Duplicate Charge",
    color: "bg-blue-100 text-blue-800 border-blue-200",
  },
  zombie_subscription: {
    label: "Zombie Subscription",
    color: "bg-teal-100 text-teal-800 border-teal-200",
  },
  unbilled_usage: {
    label: "Unbilled Usage",
    color: "bg-yellow-100 text-yellow-800 border-yellow-200",
  },
  disputed_charge: {
    label: "Disputed Charge",
    color: "bg-green-100 text-green-800 border-green-200",
  },
  fee_discrepancy: {
    label: "Fee Discrepancy",
    color: "bg-purple-100 text-purple-800 border-purple-200",
  },
  pricing_mismatch: {
    label: "Pricing Mismatch",
    color: "bg-pink-100 text-pink-800 border-pink-200",
  },
  other: {
    label: "Other",
    color: "bg-slate-100 text-slate-800 border-slate-200",
  },
};

export function AnomalySidePanel({ anomaly, open, onClose }: AnomalySidePanelProps) {
  if (!open || !anomaly) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/20 z-40 transition-opacity"
        onClick={onClose}
      />
      
      {/* Side Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-[600px] bg-white shadow-2xl z-50 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-8 py-6 flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-slate-900">Anomaly Details</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="px-8 py-6 space-y-8">
          {/* Category Badge */}
          <div>
            <Badge
              variant="outline"
              className={`border ${categoryConfig[anomaly.category]?.color ?? categoryConfig.other.color}`}
            >
              {categoryConfig[anomaly.category]?.label ?? categoryConfig.other.label}
            </Badge>
          </div>

          {/* Confidence */}
          <div>
            <p className="text-sm font-medium text-slate-500 mb-2">Confidence Level</p>
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
            <p className="text-sm font-medium text-slate-500 mb-2">Description</p>
            <p className="text-base text-slate-900">
              {anomaly.description ?? "No description available"}
            </p>
          </div>

          {/* Financial Impact */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-slate-200 p-4">
              <p className="text-sm text-slate-500">Annual Impact</p>
              <p className="mt-2 text-3xl font-semibold text-[#DC2626]">
                {formatCurrency(anomaly.annual_impact)}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 p-4">
              <p className="text-sm text-slate-500">Monthly Impact</p>
              <p className="mt-2 text-3xl font-semibold text-[#DC2626]">
                {formatCurrency(anomaly.monthly_impact)}
              </p>
            </div>
          </div>

          {/* Root Cause */}
          <div>
            <p className="text-sm font-medium text-slate-500 mb-2">Root Cause</p>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-4">
              <p className="text-base text-slate-900">
                {anomaly.root_cause ?? "Analysis pending"}
              </p>
            </div>
          </div>

          {/* Recommendation */}
          <div>
            <p className="text-sm font-medium text-slate-500 mb-2">Recommendation</p>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-4">
              <p className="text-base text-slate-900">
                {anomaly.recommendation ?? "Review required"}
              </p>
            </div>
          </div>

          {/* Customer Info */}
          {anomaly.customer_id && (
            <div>
              <p className="text-sm font-medium text-slate-500 mb-2">Customer ID</p>
              <p className="text-base font-mono text-slate-900">
                {anomaly.customer_id}
              </p>
            </div>
          )}

          {/* Metadata */}
          {anomaly.metadata && Object.keys(anomaly.metadata).length > 0 && (
            <div>
              <p className="text-sm font-medium text-slate-500 mb-2">Additional Details</p>
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-4">
                <pre className="text-sm text-slate-900 whitespace-pre-wrap font-mono">
                  {JSON.stringify(anomaly.metadata, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <Button className="flex-1" variant="default">
              Mark as Resolved
            </Button>
            <Button className="flex-1" variant="outline">
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
