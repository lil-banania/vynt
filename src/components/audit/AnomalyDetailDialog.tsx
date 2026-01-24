"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Anomaly } from "@/lib/types/database";
import { Separator } from "@/components/ui/separator";

type AnomalyDetailDialogProps = {
  anomaly: Anomaly | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
    color: "bg-orange-100 text-orange-700",
  },
  duplicate_charge: {
    label: "Duplicate Charge",
    color: "bg-blue-100 text-blue-700",
  },
  zombie_subscription: {
    label: "Zombie Subscription",
    color: "bg-teal-100 text-teal-700",
  },
  unbilled_usage: {
    label: "Unbilled Usage",
    color: "bg-yellow-100 text-yellow-700",
  },
  disputed_charge: {
    label: "Disputed Charge",
    color: "bg-green-100 text-green-700",
  },
  fee_discrepancy: {
    label: "Fee Discrepancy",
    color: "bg-purple-100 text-purple-700",
  },
  pricing_mismatch: {
    label: "Pricing Mismatch",
    color: "bg-pink-100 text-pink-700",
  },
  other: {
    label: "Other",
    color: "bg-slate-100 text-slate-700",
  },
};

export function AnomalyDetailDialog({
  anomaly,
  open,
  onOpenChange,
}: AnomalyDetailDialogProps) {
  if (!anomaly) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Anomaly Details</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Category & Confidence */}
          <div className="flex items-center gap-2">
            <Badge
              variant="secondary"
              className={
                categoryConfig[anomaly.category]?.color ??
                categoryConfig.other.color
              }
            >
              {categoryConfig[anomaly.category]?.label ??
                categoryConfig.other.label}
            </Badge>
            <Badge
              variant={
                anomaly.confidence === "high"
                  ? "default"
                  : anomaly.confidence === "medium"
                    ? "secondary"
                    : "outline"
              }
            >
              {anomaly.confidence} confidence
            </Badge>
          </div>

          {/* Description */}
          <div>
            <h3 className="text-sm font-medium text-slate-700 mb-1">
              Description
            </h3>
            <p className="text-sm text-slate-600">
              {anomaly.description ?? "No description available"}
            </p>
          </div>

          <Separator />

          {/* Customer Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="text-sm font-medium text-slate-700 mb-1">
                Customer ID
              </h3>
              <p className="font-mono text-sm text-slate-900">
                {anomaly.customer_id ?? "Unknown"}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-700 mb-1">Status</h3>
              <Badge variant="outline">{anomaly.status}</Badge>
            </div>
          </div>

          <Separator />

          {/* Financial Impact */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="text-sm font-medium text-slate-700 mb-1">
                Monthly Impact
              </h3>
              <p className="text-2xl font-semibold text-slate-900">
                {formatCurrency(anomaly.monthly_impact)}
              </p>
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-700 mb-1">
                Annual Impact
              </h3>
              <p className="text-2xl font-semibold text-rose-600">
                {formatCurrency(anomaly.annual_impact)}
              </p>
            </div>
          </div>

          <Separator />

          {/* Root Cause */}
          <div>
            <h3 className="text-sm font-medium text-slate-700 mb-1">
              Root Cause
            </h3>
            <p className="text-sm text-slate-600">
              {anomaly.root_cause ?? "Analysis pending"}
            </p>
          </div>

          {/* Recommendation */}
          <div>
            <h3 className="text-sm font-medium text-slate-700 mb-1">
              Recommendation
            </h3>
            <p className="text-sm text-slate-600">
              {anomaly.recommendation ?? "Review required"}
            </p>
          </div>

          {/* Metadata */}
          {anomaly.metadata && (
            <>
              <Separator />
              <div>
                <h3 className="text-sm font-medium text-slate-700 mb-2">
                  Additional Data
                </h3>
                <pre className="rounded-lg bg-slate-50 p-3 text-xs font-mono text-slate-700 overflow-x-auto">
                  {JSON.stringify(anomaly.metadata, null, 2)}
                </pre>
              </div>
            </>
          )}

          {/* Detected At */}
          <div className="text-xs text-slate-400">
            Detected on{" "}
            {anomaly.detected_at
              ? new Date(anomaly.detected_at).toLocaleString()
              : "Unknown"}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
