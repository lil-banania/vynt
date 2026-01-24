"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Audit } from "@/lib/types/database";
import { AuditsTableBody } from "./AuditsTableBody";
import { AuditFilters } from "./AuditFilters";

type AuditsListProps = {
  audits: Audit[];
};

export function AuditsList({ audits }: AuditsListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Filter audits
  const filteredAudits = useMemo(() => {
    return audits.filter((audit) => {
      // Search filter
      if (searchQuery) {
        const auditId = `au${audit.id.slice(0, 5)}-${audit.id.slice(5, 7)}`;
        if (!auditId.toLowerCase().includes(searchQuery.toLowerCase())) {
          return false;
        }
      }

      // Date filter
      if (dateFilter !== "all" && audit.audit_period_start) {
        const auditDate = new Date(audit.audit_period_start);
        const now = new Date();
        const daysDiff = Math.floor(
          (now.getTime() - auditDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (dateFilter === "last-30" && daysDiff > 30) return false;
        if (dateFilter === "last-90" && daysDiff > 90) return false;
        if (dateFilter === "last-year" && daysDiff > 365) return false;
      }

      // Status filter
      if (statusFilter !== "all") {
        if (statusFilter === "published" && audit.status !== "published") {
          return false;
        }
        if (statusFilter === "in_progress" && audit.status === "published") {
          return false;
        }
      }

      return true;
    });
  }, [audits, searchQuery, dateFilter, statusFilter]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredAudits.length / itemsPerPage));
  const paginatedAudits = filteredAudits.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Reset to page 1 when filters change
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  const handleDateChange = (value: string) => {
    setDateFilter(value);
    setCurrentPage(1);
  };

  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    setCurrentPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <AuditFilters
        onSearchChange={handleSearchChange}
        onDateChange={handleDateChange}
        onStatusChange={handleStatusChange}
      />

      {/* Table */}
      <div className="rounded-lg border border-slate-200">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300" />
              </TableHead>
              <TableHead>Audit ID</TableHead>
              <TableHead>Audit period</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Anomalies</TableHead>
              <TableHead className="text-right">Revenue at risk</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <AuditsTableBody audits={paginatedAudits} />
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Showing {filteredAudits.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1} to{" "}
          {Math.min(currentPage * itemsPerPage, filteredAudits.length)} of{" "}
          {filteredAudits.length} results
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
