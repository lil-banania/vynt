"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, Filter } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Anomaly } from "@/lib/types/database";
import { AnomalySidePanel } from "./AnomalySidePanel";
import { categoryConfig, formatCurrency } from "@/lib/utils/category-config";

type AnomalyTableProps = {
  anomalies: Anomaly[];
};

const statusLabelMap: Record<string, string> = {
  detected: "Detected",
  in_progress: "In progress",
  recovered: "Recovered",
};

// Exact from Figma "All anomalies" frame:
// - High: bg #DCFCE7, border #BBF7D0, text #15803D
// - Low: bg #FFFFFF, border #E7E5E4, text #0A0A0A
// - Medium isn't visible in the sampled frame; we match the Figma warning token.
const confidenceConfig: Record<
  string,
  { label: string; bgHex: string; borderHex: string; textHex: string }
> = {
  high: { label: "High", bgHex: "#DCFCE7", borderHex: "#BBF7D0", textHex: "#15803D" },
  medium: { label: "Medium", bgHex: "#FEF3C7", borderHex: "#FDE68A", textHex: "#A16207" },
  low: { label: "Low", bgHex: "#FFFFFF", borderHex: "#E7E5E4", textHex: "#0A0A0A" },
};

export function AnomalyTable({ anomalies }: AnomalyTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedAnomaly, setSelectedAnomaly] = useState<Anomaly | null>(null);
  
  // Filters
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterConfidence, setFilterConfidence] = useState<string>("all");

  const pageSize = 6; // Fixed 6 lines per page

  // Get unique categories, statuses, and confidence levels
  const categories = useMemo(() => {
    const unique = new Set(anomalies.map((a) => a.category));
    return Array.from(unique).sort();
  }, [anomalies]);

  // Apply filters
  const filteredAnomalies = useMemo(() => {
    return anomalies.filter((anomaly) => {
      if (filterCategory !== "all" && anomaly.category !== filterCategory) return false;
      if (filterStatus !== "all" && anomaly.status !== filterStatus) return false;
      if (filterConfidence !== "all" && anomaly.confidence !== filterConfidence) return false;
      return true;
    });
  }, [anomalies, filterCategory, filterStatus, filterConfidence]);

  const totalPages = Math.max(1, Math.ceil(filteredAnomalies.length / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const currentAnomalies = filteredAnomalies.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  const handleFilterChange = () => {
    setCurrentPage(1);
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
      <div className="space-y-4">
        {/* Filters */}
        <div className="flex items-center gap-4 rounded-lg border border-[#E7E5E4] bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-[#0A0A0A]">
            <Filter className="h-4 w-4" />
            <span>Filters:</span>
          </div>
          
          <Select
            value={filterCategory}
            onValueChange={(value) => {
              setFilterCategory(value);
              handleFilterChange();
            }}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {categoryConfig[cat]?.label || cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filterStatus}
            onValueChange={(value) => {
              setFilterStatus(value);
              handleFilterChange();
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="detected">Detected</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="recovered">Recovered</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={filterConfidence}
            onValueChange={(value) => {
              setFilterConfidence(value);
              handleFilterChange();
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Confidence" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Confidence</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>

          {(filterCategory !== "all" || filterStatus !== "all" || filterConfidence !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilterCategory("all");
                setFilterStatus("all");
                setFilterConfidence("all");
                handleFilterChange();
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        {/* Table */}
        <div className="rounded-lg border border-[#E7E5E4] bg-white">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-[#E7E5E4]">
                {/* Match Figma column proportions */}
                <TableHead className="text-sm font-normal text-[#0A0A0A] w-[281px]">
                  Anomaly type
                </TableHead>
                <TableHead className="text-sm font-normal text-[#0A0A0A] w-[281px]">
                  Customer ID
                </TableHead>
                <TableHead className="text-sm font-normal text-[#0A0A0A] w-[197px]">
                  Confidence
                </TableHead>
                <TableHead className="text-sm font-normal text-[#0A0A0A] w-[112px]">
                  Status
                </TableHead>
                <TableHead className="text-sm font-normal text-[#0A0A0A] w-[140px] text-right">
                  Annual impact
                </TableHead>
                <TableHead className="w-[140px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentAnomalies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-[#78716C] py-8">
                    No anomalies match the selected filters.
                  </TableCell>
                </TableRow>
              ) : (
                currentAnomalies.map((anomaly) => {
                  const config = categoryConfig[anomaly.category] || categoryConfig.other;
                  const statusLabel =
                    statusLabelMap[anomaly.status || "detected"] || anomaly.status || "Detected";
                  const confidence =
                    confidenceConfig[anomaly.confidence] || confidenceConfig.low;

                  return (
                    <TableRow key={anomaly.id} className="border-[#E7E5E4]">
                      <TableCell className="w-[281px]">
                        <Badge
                          variant="outline"
                          className={`${config.badgeClass} text-xs font-medium leading-4 px-2 py-0.5 rounded-md`}
                        >
                          {config.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-[#78716C] w-[281px]">
                        {anomaly.customer_id?.slice(0, 16) ?? "—"}
                      </TableCell>
                      <TableCell className="w-[197px]">
                        <span
                          className="inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium leading-4"
                          style={{
                            backgroundColor: confidence.bgHex,
                            borderColor: confidence.borderHex,
                            color: confidence.textHex,
                          }}
                        >
                          {confidence.label}
                        </span>
                      </TableCell>
                      <TableCell className="w-[112px]">
                        <span className="text-sm font-normal text-[#0A0A0A]">
                          {statusLabel}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-normal text-[#0A0A0A] w-[140px]">
                        {formatCurrency(anomaly.annual_impact)}
                      </TableCell>
                      <TableCell className="w-[140px]">
                        <button
                          onClick={() => setSelectedAnomaly(anomaly)}
                          className="text-xs font-normal text-[#0A0A0A] underline hover:text-[#78716C] transition-colors"
                        >
                          View details
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm font-normal text-[#78716C]">
            <div>
              Showing {startIndex + 1} to {Math.min(endIndex, filteredAnomalies.length)} of{" "}
              {filteredAnomalies.length} anomalies
            </div>
            <div className="flex items-center gap-4">
              <span className="font-normal text-[#0A0A0A]">
                Page {currentPage} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-6 w-6" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                >
                  <ChevronRight className="h-6 w-6" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <AnomalySidePanel
        anomaly={selectedAnomaly}
        open={!!selectedAnomaly}
        onClose={() => setSelectedAnomaly(null)}
      />
    </>
  );
}
