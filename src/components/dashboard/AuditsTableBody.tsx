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
};

// Format functions moved to Client Component
const formatCurrency = (value: number | null) => {
  if (value === null) return "$0";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
};

const formatDateRange = (start: string | null, end: string | null) => {
  if (!start || !end) return "Period not set";
  const formatMonth = (date: string) =>
    new Date(date).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  return `${formatMonth(start)} - ${formatMonth(end)}`;
};

const formatAuditId = (id: string) => {
  return `au${id.slice(0, 5)}-${id.slice(5, 7)}`;
};

const StatusBadge = ({ status }: { status: Audit["status"] }) => {
  if (status === "published") {
    return (
      <Badge className="bg-orange-500 hover:bg-orange-500 text-white border-0">
        Published
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-slate-600">
      In progress
    </Badge>
  );
};

export function AuditsTableBody({ audits }: AuditsTableBodyProps) {
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
