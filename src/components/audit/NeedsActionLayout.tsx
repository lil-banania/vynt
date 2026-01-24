"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
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
import { AnomalySidePanel } from "./AnomalySidePanel";
import { CommonPatternsColumn } from "./CommonPatternsColumn";
import { categoryConfig, formatCurrency } from "@/lib/utils/category-config";

type NeedsActionLayoutProps = {
  anomalies: Anomaly[];
};

function TopIssuesColumn({
  anomalies,
  onDetailsClick,
}: {
  anomalies: Anomaly[];
  onDetailsClick: (anomaly: Anomaly) => void;
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;
  const totalPages = Math.ceil(anomalies.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const displayedAnomalies = anomalies.slice(startIndex, startIndex + itemsPerPage);

  return (
    <div className="bg-white border border-[#E7E5E4] rounded-lg shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="text-base font-medium text-[#0C0A09]">Top issues</h3>
            <Info className="h-4 w-4 text-[#0A0A0A]" />
          </div>
          <p className="text-sm text-[#78716C] mt-1.5">By Financial Impact</p>
        </div>
      </div>

      {/* Table */}
      <div className="px-4 pb-6">
        <Table>
          <TableHeader>
            <TableRow className="border-[#E7E5E4]">
              <TableHead className="w-[25px] px-2"></TableHead>
              <TableHead className="text-sm font-medium text-[#0A0A0A]">Event type</TableHead>
              <TableHead className="text-sm font-medium text-[#0A0A0A]">Impact</TableHead>
              <TableHead className="w-[48px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayedAnomalies.map((anomaly, index) => {
              const monthlyImpact = (anomaly.annual_impact ?? 0) / 12;
              const config = categoryConfig[anomaly.category] || categoryConfig.other;
              
              return (
                <TableRow key={anomaly.id} className="border-[#E7E5E4]">
                  <TableCell className="px-2 text-sm text-[#0A0A0A]">
                    {startIndex + index + 1}
                  </TableCell>
                  <TableCell>
                    <Badge className={`${config.badgeClass} border-transparent`}>
                      {config.label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm text-[#0A0A0A]">
                        {formatCurrency(monthlyImpact)}/mo
                      </span>
                      <span className="text-sm text-[#78716C]">
                        {formatCurrency(anomaly.annual_impact)}/yr
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs shadow-sm"
                      onClick={() => onDetailsClick(anomaly)}
                    >
                      Details
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {/* Pagination */}
        <div className="flex items-center justify-end gap-8 mt-3 pt-3">
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
    </div>
  );
}

export function NeedsActionLayout({ anomalies }: NeedsActionLayoutProps) {
  const [selectedAnomaly, setSelectedAnomaly] = useState<Anomaly | null>(null);

  // Sort by annual impact DESC and take top 10
  const sortedAnomalies = [...anomalies]
    .sort((a, b) => (b.annual_impact ?? 0) - (a.annual_impact ?? 0))
    .slice(0, 10);

  // Top 5 issues by annual impact (already sorted)
  const topIssues = sortedAnomalies.slice(0, 5);

  return (
    <>
      <div className="grid grid-cols-2 gap-5 overflow-clip">
        {/* Left Column: Top Issues */}
        <TopIssuesColumn
          anomalies={topIssues}
          onDetailsClick={setSelectedAnomaly}
        />

        {/* Right Column: Common Patterns (AI Analysis) */}
        <CommonPatternsColumn anomalies={sortedAnomalies} />
      </div>

      <AnomalySidePanel
        anomaly={selectedAnomaly}
        open={!!selectedAnomaly}
        onClose={() => setSelectedAnomaly(null)}
      />
    </>
  );
}
