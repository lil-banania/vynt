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

const statusConfig: Record<string, { label: string; color: string }> = {
  detected: { label: "Detected", color: "bg-[#EF4444] text-white" },
  in_progress: { label: "In Progress", color: "bg-[#F59E0B] text-white" },
  recovered: { label: "Recovered", color: "bg-[#15803D] text-white" },
};

const confidenceConfig: Record<string, { label: string; color: string }> = {
  high: { label: "High", color: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  medium: { label: "Medium", color: "bg-amber-100 text-amber-800 border-amber-200" },
  low: { label: "Low", color: "bg-slate-100 text-slate-800 border-slate-200" },
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
                <TableHead className="text-sm font-medium text-[#0A0A0A]">Category</TableHead>
                <TableHead className="text-sm font-medium text-[#0A0A0A]">Customer ID</TableHead>
                <TableHead className="text-sm font-medium text-[#0A0A0A]">Description</TableHead>
                <TableHead className="text-sm font-medium text-[#0A0A0A]">Status</TableHead>
                <TableHead className="text-sm font-medium text-[#0A0A0A]">Confidence</TableHead>
                <TableHead className="text-right text-sm font-medium text-[#0A0A0A]">Annual Impact</TableHead>
                <TableHead className="w-[120px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentAnomalies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-[#78716C] py-8">
                    No anomalies match the selected filters.
                  </TableCell>
                </TableRow>
              ) : (
                currentAnomalies.map((anomaly) => {
                  const config = categoryConfig[anomaly.category] || categoryConfig.other;
                  const status = statusConfig[anomaly.status || "detected"] || statusConfig.detected;
                  const confidence = confidenceConfig[anomaly.confidence] || confidenceConfig.low;

                  return (
                    <TableRow key={anomaly.id} className="border-[#E7E5E4]">
                      <TableCell>
                        <Badge className={`${config.badgeClass} border-transparent`}>
                          {config.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-[#78716C]">
                        {anomaly.customer_id?.slice(0, 16) ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-sm text-[#78716C]">
                        {anomaly.description ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge className={`${status.color} border-transparent`}>
                          {status.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`${confidence.color}`}>
                          {confidence.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium text-[#DC2626]">
                        {formatCurrency(anomaly.annual_impact)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedAnomaly(anomaly)}
                        >
                          View Details
                        </Button>
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
          <div className="flex items-center justify-between text-sm text-[#78716C]">
            <div>
              Showing {startIndex + 1} to {Math.min(endIndex, filteredAnomalies.length)} of{" "}
              {filteredAnomalies.length} anomalies
            </div>
            <div className="flex items-center gap-4">
              <span className="font-medium text-[#0A0A0A]">
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
