import { redirect } from "next/navigation";

import AdminAuditTable from "@/components/dashboard/AdminAuditTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { Audit, Profile } from "@/lib/types/database";

type Organization = {
  id: string;
  name: string;
};

type UploadedFile = {
  id: string;
  audit_id: string;
  file_name: string;
  file_type: string;
};

const AdminPage = async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, organization_id, role")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  const isAdmin = profile?.role === "vynt_admin";

  if (!isAdmin) {
    redirect("/dashboard");
  }

  const { data: organizationsData } = await supabase
    .from("organizations")
    .select("id, name")
    .returns<Organization[]>();
  const organizations = organizationsData ?? [];
  const organizationNameMap = new Map(
    organizations.map((org) => [org.id, org.name])
  );

  const { data: auditsData } = await supabase
    .from("audits")
    .select(
      "id, organization_id, status, audit_period_start, audit_period_end, total_anomalies, annual_revenue_at_risk, created_at, published_at, created_by"
    )
    .order("created_at", { ascending: false })
    .returns<Audit[]>();

  const audits = auditsData ?? [];
  const auditIds = audits.map((audit) => audit.id);

  const { data: uploadedFilesData } = auditIds.length > 0
    ? await supabase
        .from("uploaded_files")
        .select("id, audit_id, file_name, file_type")
        .in("audit_id", auditIds)
        .returns<UploadedFile[]>()
    : { data: [] };

  const uploadedFiles = uploadedFilesData ?? [];

  const uploadedFilesByAudit = uploadedFiles.reduce<Record<string, UploadedFile[]>>(
    (acc, file) => {
      if (!acc[file.audit_id]) {
        acc[file.audit_id] = [];
      }
      acc[file.audit_id].push(file);
      return acc;
    },
    {}
  );

  const auditsWithFiles = audits.map((audit) => ({
    ...audit,
    organization_name:
      organizationNameMap.get(audit.organization_id) ?? "Organization",
    uploaded_files: uploadedFilesByAudit[audit.id] ?? [],
  }));

  return (
    <div className="space-y-6">
      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold text-slate-900">
            Admin Audits
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600">
          Manage audits across all organizations. Use Preview to see the client view before publishing.
        </CardContent>
      </Card>

      <AdminAuditTable audits={auditsWithFiles} />
    </div>
  );
};

export default AdminPage;
