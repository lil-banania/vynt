import Link from "next/link";
import { redirect } from "next/navigation";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";

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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { Audit, Profile } from "@/lib/types/database";
import { AuditsTableBody } from "@/components/dashboard/AuditsTableBody";

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
          <AuditsTableBody
            audits={audits}
            formatAuditId={formatAuditId}
            formatDateRange={formatDateRange}
            formatCurrency={formatCurrency}
            StatusBadge={StatusBadge}
          />
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
