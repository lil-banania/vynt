import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/server";
import { Anomaly, Audit, Profile, AnomalyCategory } from "@/lib/types/database";

// Charts
import { AreaChartWrapper } from "./AreaChartWrapper";
import { BarChartWrapper } from "./BarChartWrapper";
import { ExportAuditButton } from "@/components/audit/ExportAuditButton";
import { AnomalyCardList } from "@/components/audit/AnomalyCardList";
import { AnomalyTable } from "@/components/audit/AnomalyTable";

type AuditDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

type AuditWithExtras = Audit & {
  ai_insights?: string | null;
  total_arr?: number | null;
};

const formatCurrency = (value: number | null) => {
  if (value === null) return "$0";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
};

const categoryConfig: Record<
  string,
  { label: string; color: string; chartColor: string }
> = {
  failed_payment: {
    label: "Failed",
    color: "bg-orange-100 text-orange-700",
    chartColor: "#fb923c",
  },
  duplicate_charge: {
    label: "Duplicate",
    color: "bg-blue-100 text-blue-700",
    chartColor: "#60a5fa",
  },
  zombie_subscription: {
    label: "Zombie",
    color: "bg-teal-100 text-teal-700",
    chartColor: "#2dd4bf",
  },
  unbilled_usage: {
    label: "Unbilled",
    color: "bg-yellow-100 text-yellow-700",
    chartColor: "#fbbf24",
  },
  disputed_charge: {
    label: "Disputed",
    color: "bg-green-100 text-green-700",
    chartColor: "#4ade80",
  },
  fee_discrepancy: {
    label: "Fee",
    color: "bg-purple-100 text-purple-700",
    chartColor: "#a78bfa",
  },
  pricing_mismatch: {
    label: "Pricing",
    color: "bg-pink-100 text-pink-700",
    chartColor: "#f472b6",
  },
  other: {
    label: "Other",
    color: "bg-slate-100 text-slate-700",
    chartColor: "#94a3b8",
  },
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

  // Admins should use the admin preview instead
  if (profile.role === "vynt_admin") {
    redirect(`/admin/preview/${id}`);
  }

  const { data: audit } = await supabase
    .from("audits")
    .select(
      "id, organization_id, status, audit_period_start, audit_period_end, total_anomalies, annual_revenue_at_risk, ai_insights, created_at, published_at, created_by, total_arr"
    )
    .eq("id", id)
    .maybeSingle<AuditWithExtras>();

  if (!audit) {
    notFound();
  }

  // Only allow access to own organization's audits
  if (audit.organization_id !== profile.organization_id) {
    redirect("/dashboard");
  }

  // Redirect to processing page if audit is still being analyzed
  if (
    audit.status === "processing" ||
    audit.status === "pending" ||
    audit.status === "draft"
  ) {
    redirect(`/audit/${id}/processing`);
  }

  // Only show completed audits (review or published) to clients
  if (audit.status !== "published" && audit.status !== "review") {
    redirect("/dashboard");
  }

  const { data: anomaliesData } = await supabase
    .from("anomalies")
    .select(
      "id, audit_id, category, customer_id, status, confidence, annual_impact, monthly_impact, description, root_cause, recommendation, metadata, detected_at"
    )
    .eq("audit_id", audit.id)
    .order("annual_impact", { ascending: false })
    .returns<Anomaly[]>();

  const anomalies = anomaliesData ?? [];

  // Calculate metrics
  const totalRevenueAtRisk = audit.annual_revenue_at_risk ?? 0;
  const estimatedRecovery = Math.round(totalRevenueAtRisk * 0.85); // 85% recoverable estimate
  const monthlyLoss = Math.round(totalRevenueAtRisk / 12);

  // Calculate category breakdown for chart
  const categoryBreakdown = anomalies.reduce(
    (acc, anomaly) => {
      const category = anomaly.category as AnomalyCategory;
      if (!acc[category]) {
        acc[category] = 0;
      }
      acc[category] += anomaly.annual_impact ?? 0;
      return acc;
    },
    {} as Record<string, number>
  );

  const chartData = Object.entries(categoryBreakdown)
    .map(([category, value]) => ({
      label:
        categoryConfig[category]?.label ?? categoryConfig.other.label,
      value,
      color:
        categoryConfig[category]?.chartColor ?? categoryConfig.other.chartColor,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // Separate anomalies by action needed
  const needsActionAnomalies = anomalies.filter(
    (a) => a.status === "detected" || a.status === "open"
  );

  // Financial metrics for summary
  const vyntAnnualCost = 60000; // Placeholder
  const netBenefitYear1 = estimatedRecovery - vyntAnnualCost;
  const roi = netBenefitYear1 / vyntAnnualCost;
  const paybackMonths =
    estimatedRecovery > 0 ? (vyntAnnualCost / estimatedRecovery) * 12 : 0;

  // Mock trend data for area chart
  const trendLabels = ["Mar 3", "Mar 22", "Feb 23", "Mar 17", "Mar 1", "Mar 14"];
  const trendData = [2500, 3200, 2800, 4100, 3800, 4500];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/dashboard"
            className="mb-2 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" />
            All audits
          </Link>
          <h1 className="text-3xl font-semibold text-slate-900">Your audit</h1>
        </div>
        <ExportAuditButton />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="border-slate-200">
          <CardContent className="pt-4">
            <p className="text-sm text-slate-500">Total anomalies</p>
            <p className="mt-1 text-3xl font-semibold text-slate-900">
              {audit.total_anomalies ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardContent className="pt-4">
            <p className="text-sm text-slate-500">Estimated Recovery</p>
            <p className="mt-1 text-3xl font-semibold text-emerald-600">
              {formatCurrency(estimatedRecovery)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardContent className="pt-4">
            <p className="text-sm text-slate-500">Annual Revenue at Risk</p>
            <p className="mt-1 text-3xl font-semibold text-rose-600">
              {formatCurrency(totalRevenueAtRisk)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-slate-200">
          <CardContent className="pt-4">
            <p className="text-sm text-slate-500">Avg. Detection Time</p>
            <p className="mt-1 text-3xl font-semibold text-slate-900">
              4-7<span className="text-lg font-normal text-slate-500">months</span>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="bg-transparent border-b border-slate-200 rounded-none p-0 h-auto">
          <TabsTrigger
            value="overview"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-slate-900 data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
          >
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="needs-action"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-slate-900 data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
          >
            Needs action
          </TabsTrigger>
          <TabsTrigger
            value="all-anomalies"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-slate-900 data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3"
          >
            All anomalies
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Row 1: Financial Summary + Industry Benchmarking */}
          <div className="grid grid-cols-2 gap-6">
            {/* Financial Impact Summary */}
            <Card className="border-slate-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">
                  Financial Impact Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4">
                  <div className="rounded-lg border border-slate-200 p-4">
                    <p className="text-xs text-slate-500">Total Revenue at Risk</p>
                    <p className="mt-1 text-2xl font-semibold text-rose-600">
                      {formatCurrency(totalRevenueAtRisk)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">85%</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-4">
                    <p className="text-xs text-slate-500">Estimated Recoverable</p>
                    <p className="mt-1 text-2xl font-semibold text-emerald-600">
                      {formatCurrency(estimatedRecovery)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">85%</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-4">
                    <p className="text-xs text-slate-500">Vynt Annual Cost</p>
                    <p className="mt-1 text-2xl font-semibold text-slate-900">
                      {formatCurrency(vyntAnnualCost)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">85%</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-4">
                    <p className="text-xs text-slate-500">Net Benefit Year 1</p>
                    <p
                      className={`mt-1 text-2xl font-semibold ${netBenefitYear1 >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                    >
                      {formatCurrency(netBenefitYear1)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-4">
                    <p className="text-xs text-slate-500">ROI</p>
                    <p
                      className={`mt-1 text-2xl font-semibold ${roi >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                    >
                      {roi.toFixed(1)}x
                    </p>
                    <p className="mt-1 text-xs text-slate-400">months</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-4">
                    <p className="text-xs text-slate-500">Payback Period</p>
                    <p className="mt-1 text-2xl font-semibold text-slate-900">
                      {paybackMonths.toFixed(1)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">months</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Industry Benchmarking */}
            <Card className="border-slate-200">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold">
                      Industry Benchmarking
                    </CardTitle>
                    <p className="text-sm text-slate-500">
                      Total for the last 3 months
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <AreaChartWrapper data={trendData} labels={trendLabels} />
              </CardContent>
            </Card>
          </div>

          {/* Row 2: Leakage Velocity + Category Breakdown */}
          <div className="grid grid-cols-3 gap-6">
            {/* Leakage Velocity */}
            <Card className="border-slate-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">
                  Leakage Velocity
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center py-8">
                <p className="text-sm text-slate-500">Current Monthly Loss:</p>
                <p className="mt-2 text-4xl font-bold text-rose-600">
                  {formatCurrency(monthlyLoss)}
                </p>
                <p className="mt-1 text-sm text-slate-400">/ month</p>
              </CardContent>
            </Card>

            {/* Breakdown by Category */}
            <Card className="col-span-2 border-slate-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">
                  Breakdown by Category
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BarChartWrapper data={chartData} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Needs Action Tab */}
        <TabsContent value="needs-action" className="space-y-4">
          <AnomalyCardList anomalies={needsActionAnomalies} />
        </TabsContent>

        {/* All Anomalies Tab */}
        <TabsContent value="all-anomalies" className="space-y-4">
          <AnomalyTable anomalies={anomalies} pageSize={10} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AuditDetailPage;
