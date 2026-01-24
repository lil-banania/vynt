"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
    color: "bg-orange-100 text-orange-700",
  },
  duplicate_charge: {
    label: "Duplicate",
    color: "bg-blue-100 text-blue-700",
  },
  zombie_subscription: {
    label: "Zombie",
    color: "bg-teal-100 text-teal-700",
  },
  unbilled_usage: {
    label: "Unbilled",
    color: "bg-yellow-100 text-yellow-700",
  },
  disputed_charge: {
    label: "Disputed",
    color: "bg-green-100 text-green-700",
  },
  fee_discrepancy: {
    label: "Fee",
    color: "bg-purple-100 text-purple-700",
  },
  pricing_mismatch: {
    label: "Pricing",
    color: "bg-pink-100 text-pink-700",
  },
  other: {
    label: "Other",
    color: "bg-slate-100 text-slate-700",
  },
};

export function AnomalyCardList({ anomalies }: AnomalyCardListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
      <div className="space-y-3">
        {anomalies.map((anomaly) => {
          const isExpanded = expandedId === anomaly.id;
          return (
            <Card
              key={anomaly.id}
              className="border-slate-200 transition-shadow hover:shadow-md"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
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
                    <h3 className="text-base font-semibold text-slate-900">
                      {anomaly.description ?? "Anomaly detected"}
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Customer: {anomaly.customer_id?.slice(0, 16) ?? "Unknown"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-slate-500">Annual Impact</p>
                    <p className="text-2xl font-semibold text-rose-600">
                      {formatCurrency(anomaly.annual_impact)}
                    </p>
                  </div>
                </div>
              </CardHeader>
              {isExpanded && (
                <CardContent className="pt-0 space-y-3">
                  <div className="rounded-lg bg-slate-50 p-4 space-y-2">
                    <div>
                      <p className="text-sm font-medium text-slate-700">Root Cause</p>
                      <p className="text-sm text-slate-600">
                        {anomaly.root_cause ?? "Analysis pending"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-700">
                        Recommendation
                      </p>
                      <p className="text-sm text-slate-600">
                        {anomaly.recommendation ?? "Review required"}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedAnomaly(anomaly)}
                    >
                      View Details
                    </Button>
                    <Button size="sm" variant="outline">
                      Mark as Resolved
                    </Button>
                    <Button size="sm" variant="outline">
                      Dismiss
                    </Button>
                  </div>
                </CardContent>
              )}
              <button
                onClick={() => setExpandedId(isExpanded ? null : anomaly.id)}
                className="w-full border-t border-slate-200 px-6 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-1"
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="h-4 w-4" />
                    Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4" />
                    Show more
                  </>
                )}
              </button>
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
