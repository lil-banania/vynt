import AdminAuditTable from "@/components/admin/AdminAuditTable";
import { createClient } from "@/lib/supabase/server";
import { Audit } from "@/lib/types/database";

type AdminPageProps = {
  searchParams: Promise<{
    status?: string;
  }>;
};

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

const AdminPage = async ({ searchParams }: AdminPageProps) => {
  const { status: statusFilter } = await searchParams;
  
  const supabase = await createClient();

  const { data: organizationsData } = await supabase
    .from("organizations")
    .select("id, name")
    .returns<Organization[]>();
  const organizations = organizationsData ?? [];
  const organizationNameMap = new Map(
    organizations.map((org) => [org.id, org.name])
  );

  let auditsQuery = supabase
    .from("audits")
    .select(
      "id, organization_id, status, audit_period_start, audit_period_end, total_anomalies, annual_revenue_at_risk, created_at, published_at, created_by"
    )
    .order("created_at", { ascending: false });

  if (statusFilter && statusFilter !== "all") {
    auditsQuery = auditsQuery.eq("status", statusFilter);
  }

  const { data: auditsData } = await auditsQuery.returns<Audit[]>();

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
      organizationNameMap.get(audit.organization_id) ?? "Unknown Organization",
    uploaded_files: uploadedFilesByAudit[audit.id] ?? [],
  }));

  // Stats
  const pendingCount = audits.filter((a) => a.status === "pending" || a.status === "processing").length;
  const reviewCount = audits.filter((a) => a.status === "review").length;
  const publishedCount = audits.filter((a) => a.status === "published").length;
  const totalRevenue = audits.reduce((sum, a) => sum + (a.annual_revenue_at_risk ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Pending Review
          </div>
          <div className="mt-2 text-3xl font-bold text-amber-500">
            {pendingCount}
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Ready to Publish
          </div>
          <div className="mt-2 text-3xl font-bold text-emerald-500">
            {reviewCount}
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Published
          </div>
          <div className="mt-2 text-3xl font-bold text-slate-300">
            {publishedCount}
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Total Revenue at Risk
          </div>
          <div className="mt-2 text-3xl font-bold text-rose-500">
            ${totalRevenue.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Audits Table */}
      <div className="rounded-lg border border-slate-800 bg-slate-950">
        <div className="border-b border-slate-800 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">
            {statusFilter === "pending" && "Pending Audits"}
            {statusFilter === "review" && "Audits Ready to Publish"}
            {(!statusFilter || statusFilter === "all") && "All Audits"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Review, validate and publish client audits
          </p>
        </div>
        <AdminAuditTable audits={auditsWithFiles} />
      </div>
    </div>
  );
};

export default AdminPage;
