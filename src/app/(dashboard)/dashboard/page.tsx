import { redirect } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { Audit, Profile } from "@/lib/types/database";
import { AuditsList } from "@/components/dashboard/AuditsList";

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

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-semibold text-[#1C1917]">Audits</h1>
      </div>

      {/* Audits List with Filters and Pagination */}
      <AuditsList audits={audits} />
    </div>
  );
};

export default DashboardPage;
