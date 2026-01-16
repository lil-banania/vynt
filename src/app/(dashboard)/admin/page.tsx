import { redirect } from "next/navigation";

import AdminAuditTable from "@/components/dashboard/AdminAuditTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";
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

  const adminSupabase = createAdminClient();
  const dataClient = adminSupabase ?? supabase;
  const { data: profile } = await dataClient
    .from("profiles")
    .select("id, organization_id, role")
    .eq("id", user.id)
    .single<Profile>();

  if (!profile || profile.role !== "vynt_admin") {
    redirect("/dashboard");
  }

  const { data: organizationsData } = await dataClient
    .from("organizations")
    .select("id, name")
    .returns<Organization[]>();
  const organizations = organizationsData ?? [];
  const organizationNameMap = new Map(
    organizations.map((org) => [org.id, org.name])
  );

  const { data: auditsData } = await dataClient
    .from("audits")
    .select(
      "id, organization_id, status, audit_period_start, audit_period_end, total_anomalies, annual_revenue_at_risk, created_at, published_at, created_by"
    )
    .order("created_at", { ascending: false })
    .returns<Audit[]>();

  const audits = auditsData ?? [];
  const auditIds = audits.map((audit) => audit.id);

  const { data: uploadedFilesData } = await dataClient
    .from("uploaded_files")
    .select("id, audit_id, file_name, file_type")
    .in("audit_id", auditIds)
    .returns<UploadedFile[]>();

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

  const updateStatus = async (formData: FormData) => {
    "use server";
    const auditId = String(formData.get("auditId") ?? "");
    const status = String(formData.get("status") ?? "");
    if (!auditId || !status) {
      return;
    }
    const serverSupabase = await createClient();
    await serverSupabase.from("audits").update({ status }).eq("id", auditId);
  };

  const publishAudit = async (formData: FormData) => {
    "use server";
    const auditId = String(formData.get("auditId") ?? "");
    if (!auditId) {
      return;
    }
    const serverSupabase = await createClient();
    await serverSupabase
      .from("audits")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", auditId);
  };

  return (
    <div className="space-y-6">
      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold text-slate-900">
            Admin Audits
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600">
          Manage audits across all organizations.
        </CardContent>
      </Card>

      <AdminAuditTable
        audits={auditsWithFiles}
        onUpdateStatus={updateStatus}
        onPublish={publishAudit}
      />
    </div>
  );
};

export default AdminPage;