"use client";

import { useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Anomaly,
  AnomalyCategory,
  AnomalyConfidence,
} from "@/lib/types/database";

export type AnomalyFilters = {
  category: AnomalyCategory | "all";
  confidence: AnomalyConfidence | "all";
  customerId: string;
};

type AnomalyTableProps = {
  anomalies: Anomaly[];
  onFilterChange?: (filters: AnomalyFilters) => void;
};

const PAGE_SIZE = 20;

const categoryLabelMap: Record<AnomalyCategory, string> = {
  zombie_subscription: "Zombie Subscription",
  unbilled_usage: "Unbilled Usage",
  pricing_mismatch: "Pricing Mismatch",
  duplicate_charge: "Duplicate Charge",
  failed_payment: "Failed Payment",
  high_refund_rate: "High Refund Rate",
  missing_in_stripe: "Missing in Stripe",
  missing_in_db: "Missing in DB",
  amount_mismatch: "Amount Mismatch",
  revenue_leakage: "Revenue Leakage",
  disputed_charge: "Disputed Charge",
  fee_discrepancy: "Fee Discrepancy",
  other: "Other",
};

const confidenceLabelMap: Record<AnomalyConfidence, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

const categoryBadgeClass = (category: AnomalyCategory) => {
  switch (category) {
    case "zombie_subscription":
      return "bg-rose-100 text-rose-700 border-rose-200";
    case "unbilled_usage":
      return "bg-amber-100 text-amber-700 border-amber-200";
    case "pricing_mismatch":
      return "bg-purple-100 text-purple-700 border-purple-200";
    case "duplicate_charge":
      return "bg-orange-100 text-orange-700 border-orange-200";
    case "failed_payment":
      return "bg-red-100 text-red-700 border-red-200";
    case "high_refund_rate":
      return "bg-yellow-100 text-yellow-700 border-yellow-200";
    case "missing_in_stripe":
      return "bg-blue-100 text-blue-700 border-blue-200";
    case "missing_in_db":
      return "bg-cyan-100 text-cyan-700 border-cyan-200";
    case "amount_mismatch":
      return "bg-indigo-100 text-indigo-700 border-indigo-200";
    case "revenue_leakage":
      return "bg-pink-100 text-pink-700 border-pink-200";
    case "disputed_charge":
      return "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200";
    case "fee_discrepancy":
      return "bg-lime-100 text-lime-700 border-lime-200";
    case "other":
    default:
      return "bg-slate-100 text-slate-700 border-slate-200";
  }
};

const confidenceBadgeClass = (confidence: AnomalyConfidence) => {
  switch (confidence) {
    case "high":
      return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "medium":
      return "bg-slate-100 text-slate-700 border-slate-200";
    case "low":
      return "bg-slate-50 text-slate-500 border-slate-200";
    default:
      return "bg-slate-100 text-slate-700 border-slate-200";
  }
};

const formatCurrency = (value: number | null) => {
  if (!value) {
    return "-";
  }
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
};

const AnomalyTable = ({ anomalies, onFilterChange }: AnomalyTableProps) => {
  const [filters, setFilters] = useState<AnomalyFilters>({
    category: "all",
    confidence: "all",
    customerId: "",
  });
  const [page, setPage] = useState(1);
  const [selectedAnomaly, setSelectedAnomaly] = useState<Anomaly | null>(null);

  useEffect(() => {
    onFilterChange?.(filters);
  }, [filters, onFilterChange]);

  const filtered = useMemo(() => {
    return anomalies.filter((anomaly) => {
      if (filters.category !== "all" && anomaly.category !== filters.category) {
        return false;
      }
      if (
        filters.confidence !== "all" &&
        anomaly.confidence !== filters.confidence
      ) {
        return false;
      }
      if (filters.customerId.trim()) {
        const value = anomaly.customer_id ?? "";
        if (
          !value.toLowerCase().includes(filters.customerId.trim().toLowerCase())
        ) {
          return false;
        }
      }
      return true;
    });
  }, [anomalies, filters]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const impactA = a.annual_impact ?? 0;
      const impactB = b.annual_impact ?? 0;
      return impactB - impactA;
    });
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paginated = sorted.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  const handleFilterChange = (next: Partial<AnomalyFilters>) => {
    setPage(1);
    setFilters((prev) => ({ ...prev, ...next }));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Select
          value={filters.category}
          onValueChange={(value: string) =>
            handleFilterChange({
              category: value as AnomalyFilters["category"],
            })
          }
        >
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            <SelectItem value="zombie_subscription">Zombie Subscription</SelectItem>
            <SelectItem value="unbilled_usage">Unbilled Usage</SelectItem>
            <SelectItem value="pricing_mismatch">Pricing Mismatch</SelectItem>
            <SelectItem value="duplicate_charge">Duplicate Charge</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.confidence}
          onValueChange={(value: string) =>
            handleFilterChange({
              confidence: value as AnomalyFilters["confidence"],
            })
          }
        >
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Confidence" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All confidence</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>

        <Input
          className="w-full sm:max-w-[240px]"
          placeholder="Search customer ID"
          value={filters.customerId}
          onChange={(event) =>
            handleFilterChange({ customerId: event.target.value })
          }
        />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead>Customer ID</TableHead>
              <TableHead>Annual Impact</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginated.map((anomaly) => (
              <TableRow key={anomaly.id}>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={categoryBadgeClass(anomaly.category)}
                  >
                    {categoryLabelMap[anomaly.category] ?? anomaly.category}
                  </Badge>
                </TableCell>
                <TableCell className="text-slate-600">
                  {anomaly.customer_id ?? "-"}
                </TableCell>
                <TableCell className="font-medium text-slate-900">
                  {formatCurrency(anomaly.annual_impact)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={confidenceBadgeClass(anomaly.confidence)}
                  >
                    {confidenceLabelMap[anomaly.confidence]}
                  </Badge>
                </TableCell>
                <TableCell className="text-slate-600">
                  {anomaly.status}
                </TableCell>
                <TableCell className="text-right">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedAnomaly(anomaly)}
                      >
                        View Details
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-lg">
                      <DialogHeader>
                        <DialogTitle>Details</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 text-sm text-slate-600">
                        <div>
                          <div className="text-xs font-semibold uppercase text-slate-500">
                            Description
                          </div>
                          <p className="mt-1 text-slate-700">
                            {selectedAnomaly?.description ?? "N/A"}
                          </p>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase text-slate-500">
                            Root Cause
                          </div>
                          <p className="mt-1 text-slate-700">
                            {selectedAnomaly?.root_cause ?? "N/A"}
                          </p>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase text-slate-500">
                            Recommendation
                          </div>
                          <p className="mt-1 text-slate-700">
                            {selectedAnomaly?.recommendation ?? "N/A"}
                          </p>
                        </div>
                        <div>
                          <div className="text-xs font-semibold uppercase text-slate-500">
                            Evidence
                          </div>
                          <div className="mt-1 space-y-1 text-slate-700">
                            <p>
                              <span className="font-semibold">Confidence:</span>{" "}
                              {typeof selectedAnomaly?.metadata?.confidence_reason === "string"
                                ? selectedAnomaly.metadata.confidence_reason
                                : "N/A"}
                            </p>
                            <p>
                              <span className="font-semibold">Impact Type:</span>{" "}
                              {typeof selectedAnomaly?.metadata?.impact_type === "string"
                                ? selectedAnomaly.metadata.impact_type
                                : "N/A"}
                            </p>
                            <p>
                              <span className="font-semibold">Detection:</span>{" "}
                              {typeof selectedAnomaly?.metadata?.detection_method === "string"
                                ? selectedAnomaly.metadata.detection_method
                                : "N/A"}
                            </p>
                          </div>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </TableCell>
              </TableRow>
            ))}
            {paginated.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-6 text-center text-sm text-slate-500"
                >
                  No anomalies found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {sorted.length > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={page === 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setPage((prev) => Math.min(totalPages, prev + 1))
              }
              disabled={page === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnomalyTable;