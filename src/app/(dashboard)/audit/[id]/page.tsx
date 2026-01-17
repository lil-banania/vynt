import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import AuditSummary from "@/components/dashboard/AuditSummary";
import AnomalyTable from "@/components/dashboard/AnomalyTable";
import CategoryBreakdown from "@/components/dashboard/CategoryBreakdown";
import ExportPdfButton from "@/components/dashboard/ExportPdfButton";
import ImpactChart from "@/components/dashboard/ImpactChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/server";
import { Anomaly, Audit, Profile } from "@/lib/types/database";

type AuditDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

type Organization = {
  id: string;
  name: string;
};

const AuditDetailPage = async ({ params }: AuditDetailPageProps) => {
  const { id } = await params;

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

  if (!profile) {
    redirect("/login");
  }

  const isAdmin = profile.role === "vynt_admin";

  const { data: audit } = await supabase
    .from("audits")
    .select(
      "id, organization_id, status, audit_period_start, audit_period_end, total_anomalies, annual_revenue_at_risk, created_at, published_at, created_by"
    )
    .eq("id", id)
    .maybeSingle<Audit>();

  if (!audit) {
    notFound();
  }

  if (!isAdmin && audit.organization_id !== profile.organization_id) {
    redirect("/dashboard");
  }

  if (!isAdmin && audit.status !== "published") {
    redirect("/dashboard");
  }

  const { data: organization } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", audit.organization_id)
    .maybeSingle<Organization>();

  const { data: anomaliesData } = await supabase
    .from("anomalies")
    .select(
      "id, audit_id, category, customer_id, status, confidence, annual_impact, monthly_impact, description, root_cause, recommendation, metadata, detected_at"
    )
    .eq("audit_id", audit.id)
    .returns<Anomaly[]>();

  const anomalies = anomaliesData ?? [];

  const anomalyCounts = {
    zombie_subscription: anomalies.filter(
      (item) => item.category === "zombie_subscription"
    ).length,
    unbilled_usage: anomalies.filter(
      (item) => item.category === "unbilled_usage"
    ).length,
    pricing_mismatch: anomalies.filter(
      (item) => item.category === "pricing_mismatch"
    ).length,
    duplicate_charge: anomalies.filter(
      (item) => item.category === "duplicate_charge"
    ).length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button asChild variant="outline">
          <Link href={isAdmin ? "/admin" : "/dashboard"}>
            {isAdmin ? "Back to admin" : "Back to dashboard"}
          </Link>
        </Button>

        <div className="flex flex-wrap items-center gap-3">
          <ExportPdfButton />
        </div>
      </div>

      {isAdmin && audit.status !== "published" && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-center gap-3 py-4 text-sm text-amber-700">
            <Badge variant="outline" className="border-amber-200 text-amber-700">
              {audit.status}
            </Badge>
            This is a preview of what the client will see once published.
          </CardContent>
        </Card>
      )}

      <AuditSummary
        audit={{
          ...audit,
          organization_name: organization?.name,
        }}
        anomalyCounts={anomalyCounts}
      />

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="anomalies">Anomalies</TabsTrigger>
          <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <ImpactChart anomalies={anomalies} />
          <CategoryBreakdown anomalyCounts={anomalyCounts} />
        </TabsContent>

        <TabsContent value="anomalies">
          <AnomalyTable anomalies={anomalies} />
        </TabsContent>

        <TabsContent value="recommendations">
          <Card className="border-slate-200">
            <CardContent className="space-y-4 py-6 text-sm text-slate-600">
              <div>
                <div className="font-semibold text-slate-900">
                  Subscription hygiene
                </div>
                <p>
                  Review inactive customers with ongoing renewals to reduce
                  zombie subscriptions.
                </p>
              </div>
              <div>
                <div className="font-semibold text-slate-900">
                  Usage billing gaps
                </div>
                <p>
                  Align usage events with Stripe invoices to recover unbilled
                  revenue faster.
                </p>
              </div>
              <div>
                <div className="font-semibold text-slate-900">
                  Pricing consistency
                </div>
                <p>
                  Standardize pricing tiers and discount rules to reduce
                  mismatches.
                </p>
              </div>
              <div>
                <div className="font-semibold text-slate-900">
                  Duplicate charge prevention
                </div>
                <p>
                  Automate duplicate charge detection before invoice
                  finalization.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AuditDetailPage;
