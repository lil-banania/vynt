import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { Audit, Profile } from "@/lib/types/database";

type DashboardPageProps = {
  searchParams?: {
    org?: string;
  };
};

type Organization = {
  id: string;
  name: string;
};

const formatCurrency = (value: number | null) => {
  if (value === null) {
    return "$0";
  }
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
};

const formatDateRange = (start: string | null, end: string | null) => {
  if (!start || !end) {
    return "Period not set";
  }
  const format = (value: string) =>
    new Date(value).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  return `${format(start)} - ${format(end)}`;
};

const statusBadgeVariant = (status: Audit["status"]) => {
  if (status === "published") {
    return "secondary";
  }
  if (status === "processing" || status === "review") {
    return "default";
  }
  return "outline";
};

const statusLabel = (status: Audit["status"]) => {
  if (status === "processing" || status === "review" || status === "pending") {
    return "In review";
  }
  if (status === "published") {
    return "Published";
  }
  if (status === "completed") {
    return "Completed";
  }
  if (status === "in_progress") {
    return "In progress";
  }
  if (status === "draft") {
    return "Draft";
  }
  return status;
};

const DashboardPage = async ({ searchParams }: DashboardPageProps) => {
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
  const selectedOrg = searchParams?.org ?? "all";

  const organizationsQuery = isAdmin
    ? dataClient.from("organizations").select("id, name")
    : dataClient
        .from("organizations")
        .select("id, name")
        .eq("id", profile.organization_id);

  const { data: organizationsData } = await organizationsQuery.returns<
    Organization[]
  >();
  const organizations = organizationsData ?? [];

  const auditsQuery = dataClient
    .from("audits")
    .select(
      "id, organization_id, status, audit_period_start, audit_period_end, total_anomalies, annual_revenue_at_risk"
    )
    .order("created_at", { ascending: false });

  if (!isAdmin) {
    auditsQuery.eq("organization_id", profile.organization_id);
  } else if (selectedOrg !== "all") {
    auditsQuery.eq("organization_id", selectedOrg);
  }

  const { data: auditsData } = await auditsQuery.returns<Audit[]>();
  const audits = auditsData ?? [];
  const orgNameById = new Map(
    organizations.map((org) => [org.id, org.name])
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Your Revenue Audits
          </h1>
          <p className="text-sm text-slate-600">
            {isAdmin
              ? "Viewing all audits across organizations."
              : "Audits for your organization, including those in progress."}
          </p>
        </div>

        {isAdmin && (
          <Card className="border-slate-200">
            <CardContent className="py-3">
              <form action="/dashboard" method="get">
                <div className="flex items-center gap-3 text-sm text-slate-600">
                  <label htmlFor="org" className="font-medium">
                    Organization
                  </label>
                  <select
                    id="org"
                    name="org"
                    defaultValue={selectedOrg}
                    className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700"
                  >
                    <option value="all">All</option>
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" variant="outline" size="sm">
                    Filter
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </div>

      {audits.length === 0 && (
        <Card className="border-slate-200">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-slate-900">
              No audits yet
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-slate-600">
            <p>Start your first revenue audit to get insights.</p>
            <Button asChild>
              <Link href="/upload">Start a new audit</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {audits.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {audits.map((audit) => (
            <Link key={audit.id} href={`/audit/${audit.id}`}>
              <Card className="h-full border-slate-200 transition hover:border-slate-300 hover:shadow-sm">
                <CardHeader className="space-y-2">
                  <div className="text-sm text-slate-500">
                    {isAdmin
                      ? orgNameById.get(audit.organization_id) ??
                        "Organization"
                      : "Organization"}
                  </div>
                  <CardTitle className="text-base font-semibold text-slate-900">
                    {formatDateRange(
                      audit.audit_period_start,
                      audit.audit_period_end
                    )}
                  </CardTitle>
                  <Badge variant={statusBadgeVariant(audit.status)}>
                    {statusLabel(audit.status)}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-slate-600">
                  <div className="flex items-center justify-between">
                    <span>Total anomalies</span>
                    <span className="font-medium text-slate-900">
                      {audit.total_anomalies ?? 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Revenue at risk</span>
                    <span className="font-medium text-slate-900">
                      {formatCurrency(audit.annual_revenue_at_risk)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default DashboardPage;