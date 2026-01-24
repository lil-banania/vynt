"use client";

import Link from "next/link";
import { MoreHorizontal, Eye, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Audit } from "@/lib/types/database";

type AuditsTableBodyProps = {
  audits: Audit[];
  formatAuditId: (id: string) => string;
  formatDateRange: (start: string | null, end: string | null) => string;
  formatCurrency: (value: number | null) => string;
  StatusBadge: React.ComponentType<{ status: Audit["status"] }>;
};

export function AuditsTableBody({
  audits,
  formatAuditId,
  formatDateRange,
  formatCurrency,
  StatusBadge,
}: AuditsTableBodyProps) {
  if (audits.length === 0) {
    return (
      <TableBody>
        <TableRow>
          <TableCell colSpan={7} className="h-32 text-center text-slate-500">
            No audits yet. Click &quot;New audit&quot; to get started.
          </TableCell>
        </TableRow>
      </TableBody>
    );
  }

  return (
    <TableBody>
      {audits.map((audit) => (
        <TableRow key={audit.id} className="cursor-pointer hover:bg-slate-50">
          <TableCell onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300" />
          </TableCell>
          <TableCell className="font-medium text-slate-900">
            <Link href={`/audit/${audit.id}`} className="block w-full">
              {formatAuditId(audit.id)}
            </Link>
          </TableCell>
          <TableCell className="text-slate-600">
            <Link href={`/audit/${audit.id}`} className="block w-full">
              {formatDateRange(audit.audit_period_start, audit.audit_period_end)}
            </Link>
          </TableCell>
          <TableCell>
            <Link href={`/audit/${audit.id}`} className="block w-full">
              <StatusBadge status={audit.status} />
            </Link>
          </TableCell>
          <TableCell className="text-right text-slate-900">
            <Link href={`/audit/${audit.id}`} className="block w-full">
              {audit.total_anomalies ?? 0}
            </Link>
          </TableCell>
          <TableCell className="text-right font-medium text-slate-900">
            <Link href={`/audit/${audit.id}`} className="block w-full">
              {formatCurrency(audit.annual_revenue_at_risk)}
            </Link>
          </TableCell>
          <TableCell onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={`/audit/${audit.id}`}>
                    <Eye className="h-4 w-4" />
                    View
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Download className="h-4 w-4" />
                  Export
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  );
}
