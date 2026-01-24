import Link from "next/link";
import { redirect } from "next/navigation";
import { MoreHorizontal, Eye, Download, Search, ChevronLeft, ChevronRight } from "lucide-react";

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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { Audit, Profile } from "@/lib/types/database";

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

type StatusBadgeProps = {
  status: Audit["status"];
};

const StatusBadge = ({ status }: StatusBadgeProps) => {
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

const DashboardPage = async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const adminSupabase = createAdminClient();
  const dataClient = adminSupabase ?? supabase;
  const { data: profile } = await dataClient
    .from("profiles")
    .select("id, organization_id, full_name, role")
    .eq("id", user.id)
    .single<Profile>();

  if (!profile) {
    redirect("/login");
  }

  const metadataRole =
    (user.app_metadata as { role?: string } | undefined)?.role ??
    (user.user_metadata as { role?: string } | undefined)?.role ??
    null;
  const isAdmin =
    profile.role === "vynt_admin" || metadataRole === "vynt_admin";

  const auditsQuery = dataClient
    .from("audits")
    .select(
      "id, organization_id, status, audit_period_start, audit_period_end, total_anomalies, annual_revenue_at_risk"
    )
    .order("created_at", { ascending: false });

  if (!isAdmin) {
    auditsQuery.eq("organization_id", profile.organization_id);
  }

  const { data: auditsData } = await auditsQuery.returns<Audit[]>();
  const audits = auditsData ?? [];

  const totalPages = Math.max(1, Math.ceil(audits.length / 10));

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-semibold text-slate-900">Audits</h1>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Audit ID"
            className="w-60 pl-9"
          />
        </div>
        <Select>
          <SelectTrigger className="w-60">
            <SelectValue placeholder="Audit time" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All time</SelectItem>
            <SelectItem value="last-30">Last 30 days</SelectItem>
            <SelectItem value="last-90">Last 90 days</SelectItem>
            <SelectItem value="last-year">Last year</SelectItem>
          </SelectContent>
        </Select>
        <Select>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="in_progress">In progress</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-200">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300" />
              </TableHead>
              <TableHead>Audit ID</TableHead>
              <TableHead>Audit time</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Anomalies</TableHead>
              <TableHead className="text-right">Total amount</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {audits.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-slate-500">
                  No audits yet. Click &quot;New audit&quot; to get started.
                </TableCell>
              </TableRow>
            ) : (
              audits.map((audit) => (
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
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {audits.length > 0 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <div>
            0 of {audits.length} row(s) selected.
          </div>
          <div className="flex items-center gap-4">
            <span>Page 1 of {totalPages}</span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-sm" disabled>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon-sm" disabled={totalPages <= 1}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
