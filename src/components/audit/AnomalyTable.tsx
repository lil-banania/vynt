"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Anomaly } from "@/lib/types/database";
import { AnomalyDetailDialog } from "./AnomalyDetailDialog";

type AnomalyTableProps = {
  anomalies: Anomaly[];
  pageSize?: number;
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

export function AnomalyTable({ anomalies, pageSize = 10 }: AnomalyTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedAnomaly, setSelectedAnomaly] = useState<Anomaly | null>(null);

  const totalPages = Math.max(1, Math.ceil(anomalies.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const currentAnomalies = anomalies.slice(startIndex, endIndex);

  if (anomalies.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 py-12 text-sm text-slate-500">
        No anomalies found.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Category</TableHead>
                <TableHead>Customer ID</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead className="text-right">Monthly Impact</TableHead>
                <TableHead className="text-right">Annual Impact</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentAnomalies.map((anomaly) => (
                <TableRow
                  key={anomaly.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => setSelectedAnomaly(anomaly)}
                >
                  <TableCell>
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
                  </TableCell>
                  <TableCell className="font-mono text-sm text-slate-600">
                    {anomaly.customer_id?.slice(0, 16) ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-slate-600">
                    {anomaly.description ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        anomaly.confidence === "high"
                          ? "default"
                          : anomaly.confidence === "medium"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {anomaly.confidence}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(anomaly.monthly_impact)}
                  </TableCell>
                  <TableCell className="text-right font-medium text-rose-600">
                    {formatCurrency(anomaly.annual_impact)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-slate-500">
            <div>
              Showing {startIndex + 1} to {Math.min(endIndex, anomalies.length)} of{" "}
              {anomalies.length} anomalies
            </div>
            <div className="flex items-center gap-4">
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <AnomalyDetailDialog
        anomaly={selectedAnomaly}
        open={!!selectedAnomaly}
        onOpenChange={(open) => !open && setSelectedAnomaly(null)}
      />
    </>
  );
}
