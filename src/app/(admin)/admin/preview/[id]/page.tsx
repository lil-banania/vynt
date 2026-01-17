import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { Anomaly, Audit } from "@/lib/types/database";

type PreviewPageProps = {
  params: Promise<{
    id: string;
  }>;
};

type Organization = {
  id: string;
  name: string;
};

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
  const format = (value: string) =>
    new Date(value).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  return `${format(start)} - ${format(end)}`;
};

const categoryLabels: Record<string, string> = {
  zombie_subscription: "Zombie Subscription",
  unbilled_usage: "Unbilled Usage",
  pricing_mismatch: "Pricing Issue",
  duplicate_charge: "Duplicate/Dispute",
  other: "Other",
};

const PreviewPage = async ({ params }: PreviewPageProps) => {
  const { id } = await params;

  const supabase = await createClient();

  const { data: audit } = await supabase
    .from("audits")
    .select(
      "id, organization_id, status, audit_period_start, audit_period_end, total_anomalies, annual_revenue_at_risk, created_at"
    )
    .eq("id", id)
    .maybeSingle<Audit>();

  if (!audit) {
    notFound();
  }

  const { data: organization } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", audit.organization_id)
    .maybeSingle<Organization>();

  const { data: anomaliesData } = await supabase
    .from("anomalies")
    .select(
      "id, category, customer_id, status, confidence, annual_impact, monthly_impact, description, root_cause, recommendation"
    )
    .eq("audit_id", audit.id)
    .order("annual_impact", { ascending: false })
    .returns<Anomaly[]>();

  const anomalies = anomaliesData ?? [];

  const anomalyCounts = {
    zombie_subscription: anomalies.filter((a) => a.category === "zombie_subscription").length,
    unbilled_usage: anomalies.filter((a) => a.category === "unbilled_usage").length,
    pricing_mismatch: anomalies.filter((a) => a.category === "pricing_mismatch").length,
    duplicate_charge: anomalies.filter((a) => a.category === "duplicate_charge").length,
    other: anomalies.filter((a) => a.category === "other").length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button
          asChild
          variant="ghost"
          className="text-slate-400 hover:text-white hover:bg-slate-800"
        >
          <Link href="/admin">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Audits
          </Link>
        </Button>

        <div className="flex items-center gap-3">
          {audit.status !== "published" && (
            <form action={`/api/audits/status`} method="POST">
              <input type="hidden" name="auditId" value={audit.id} />
              <input type="hidden" name="status" value="published" />
              <Button className="bg-emerald-600 hover:bg-emerald-700">
                <Check className="mr-2 h-4 w-4" />
                Publish Audit
              </Button>
            </form>
          )}
        </div>
      </div>

      {/* Preview Banner */}
      <div className="rounded-lg border border-amber-600/50 bg-amber-950/50 px-4 py-3 text-sm text-amber-400">
        <strong>Preview Mode:</strong> This is how the client will see their audit once published.
      </div>

      {/* Client View Preview */}
      <div className="rounded-lg border border-slate-700 bg-slate-50 p-6 text-slate-900">
        {/* Organization Header */}
        <div className="mb-6 border-b border-slate-200 pb-6">
          <h1 className="text-2xl font-bold text-slate-900">
            {organization?.name ?? "Organization"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {formatDateRange(audit.audit_period_start, audit.audit_period_end)}
          </p>
        </div>

        {/* Summary Cards */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-500">Total Anomalies</div>
            <div className="mt-1 text-3xl font-bold text-slate-900">
              {audit.total_anomalies ?? 0}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-500">Annual Revenue at Risk</div>
            <div className="mt-1 text-3xl font-bold text-rose-600">
              {formatCurrency(audit.annual_revenue_at_risk)}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-500">Monthly Impact</div>
            <div className="mt-1 text-3xl font-bold text-slate-900">
              {formatCurrency((audit.annual_revenue_at_risk ?? 0) / 12)}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-500">Recovery Potential</div>
            <div className="mt-1 text-3xl font-bold text-emerald-600">85-90%</div>
          </div>
        </div>

        {/* Breakdown by Category */}
        <div className="mb-8">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Breakdown by Category</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(anomalyCounts).map(([key, count]) => (
              <div key={key} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  {categoryLabels[key] ?? key}
                </div>
                <div className="mt-1 text-2xl font-bold text-slate-900">{count}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Anomalies List */}
        <div>
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Detected Anomalies</h2>
          {anomalies.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-500">
              No anomalies detected.
            </div>
          ) : (
            <div className="space-y-3">
              {anomalies.slice(0, 10).map((anomaly) => (
                <div
                  key={anomaly.id}
                  className="rounded-lg border border-slate-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          {categoryLabels[anomaly.category] ?? anomaly.category}
                        </span>
                        <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700">
                          {formatCurrency(anomaly.annual_impact)}/year
                        </span>
                        {anomaly.customer_id && (
                          <span className="text-xs text-slate-500">
                            Customer: {anomaly.customer_id}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-slate-700">{anomaly.description}</p>
                      {anomaly.recommendation && (
                        <p className="mt-2 text-sm text-emerald-700">
                          <strong>Recommendation:</strong> {anomaly.recommendation}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {anomalies.length > 10 && (
                <div className="text-center text-sm text-slate-500">
                  And {anomalies.length - 10} more anomalies...
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PreviewPage;
