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
import { IndustryBenchmarking } from "./IndustryBenchmarking";
import { ExportAuditButton } from "@/components/audit/ExportAuditButton";
import { NeedsActionLayout } from "@/components/audit/NeedsActionLayout";
import { AnomalyTable } from "@/components/audit/AnomalyTable";
import { categoryConfig as categoryStyleConfig } from "@/lib/utils/category-config";

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
        categoryStyleConfig[category]?.label ?? categoryStyleConfig.other.label,
      value,
      color:
        categoryStyleConfig[category]?.chartColor ??
        categoryStyleConfig.other.chartColor,
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
  const trendLabels3Mo = ["Mar 3", "Mar 22", "Feb 23", "Mar 17", "Mar 1", "Mar 14"];
  const trendData3Mo = [2500, 3200, 2800, 4100, 3800, 4500];
  const trendLabelsYear = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const trendDataYear = [2000, 2200, 2500, 3200, 2800, 4100, 3800, 4500, 4200, 3900, 4300, 4600];

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
          <h1 className="font-['Literata'] text-4xl font-normal leading-10 tracking-[-1.5px] text-[#1C1917]">
            Your audit
          </h1>
        </div>
        <ExportAuditButton />
      </div>

      {/* KPI Cards - Compact Figma design */}
      <div className="grid grid-cols-4 gap-3">
        <Card className="border-[#E7E5E4] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]">
          <CardContent className="p-3">
            <p className="text-sm font-normal leading-5 text-[#78716C]">Total anomalies</p>
            <p className="mt-1 text-2xl font-semibold text-[#1C1917]">
              {audit.total_anomalies ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card className="border-[#E7E5E4] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]">
          <CardContent className="p-3">
            <p className="text-sm font-normal leading-5 text-[#78716C]">Estimated Recovery</p>
            <p className="mt-1 text-2xl font-semibold text-[#15803D]">
              {formatCurrency(estimatedRecovery)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-[#E7E5E4] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]">
          <CardContent className="p-3">
            <p className="text-sm font-normal leading-5 text-[#78716C]">Annual Revenue at Risk</p>
            <p className="mt-1 text-2xl font-semibold text-[#991B1B]">
              {formatCurrency(totalRevenueAtRisk)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-[#E7E5E4] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]">
          <CardContent className="p-3">
            <p className="text-sm font-normal leading-5 text-[#78716C]">Avg. Detection Time</p>
            <p className="mt-1 text-2xl font-semibold text-[#1C1917]">
              4-7<span className="text-sm font-medium text-[#78716C]">months</span>
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
              <CardContent className="px-0">
                <div className="flex items-center divide-x divide-[#E7E5E4]">
                  {/* Total Revenue at Risk */}
                  <div className="flex-1 px-4 py-2">
                    <p className="text-sm font-normal text-[#78716C]">Total Revenue at Risk</p>
                    <p className="mt-2 text-2xl font-normal text-[#DC2626]">
                      {formatCurrency(totalRevenueAtRisk)}
                    </p>
                    <p className="mt-1 text-xs font-normal text-[#A8A29E]">85%</p>
                  </div>
                  
                  {/* Estimated Recoverable */}
                  <div className="flex-1 px-4 py-2">
                    <p className="text-sm font-normal text-[#78716C]">Estimated Recoverable</p>
                    <p className="mt-2 text-2xl font-normal text-[#15803D]">
                      {formatCurrency(estimatedRecovery)}
                    </p>
                    <p className="mt-1 text-xs font-normal text-[#A8A29E]">85%</p>
                    </div>
                    
                  {/* Vynt Annual Cost */}
                  <div className="flex-1 px-4 py-2">
                    <p className="text-sm font-normal text-[#78716C]">Vynt Annual Cost</p>
                    <p className="mt-2 text-2xl font-normal text-[#1C1917]">
                      {formatCurrency(vyntAnnualCost)}
                    </p>
                    <p className="mt-1 text-xs font-normal text-[#A8A29E]">85%</p>
                  </div>
                </div>
                
                <div className="h-px bg-[#E7E5E4]" />
                
                <div className="flex items-center divide-x divide-[#E7E5E4]">
                  {/* Net Benefit Year 1 */}
                  <div className="flex-1 px-4 py-2">
                    <p className="text-sm font-normal text-[#78716C]">Net Benefit Year 1</p>
                    <p
                      className={`mt-2 text-2xl font-normal ${netBenefitYear1 >= 0 ? "text-[#15803D]" : "text-[#DC2626]"}`}
                    >
                      {formatCurrency(netBenefitYear1)}
                    </p>
          </div>
          
                  {/* ROI */}
                  <div className="flex-1 px-4 py-2">
                    <p className="text-sm font-normal text-[#78716C]">ROI</p>
                    <p
                      className={`mt-2 text-2xl font-normal ${roi >= 0 ? "text-[#15803D]" : "text-[#DC2626]"}`}
                    >
                      {roi.toFixed(1)}x
                    </p>
                    <p className="mt-1 text-xs font-normal text-[#A8A29E]">months</p>
          </div>
                  
                  {/* Payback Period */}
                  <div className="flex-1 px-4 py-2">
                    <p className="text-sm font-normal text-[#78716C]">Payback Period</p>
                    <p className="mt-2 text-2xl font-normal text-[#1C1917]">
                      {paybackMonths.toFixed(1)}
                    </p>
                    <p className="mt-1 text-xs font-normal text-[#A8A29E]">months</p>
                  </div>
          </div>
              </CardContent>
            </Card>

            {/* Industry Benchmarking */}
            <IndustryBenchmarking
              data3Mo={trendData3Mo}
              labels3Mo={trendLabels3Mo}
              dataYear={trendDataYear}
              labelsYear={trendLabelsYear}
            />
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
                <p className="text-xs font-medium leading-none text-[#78716C]">
                  Current Monthly Loss:
                </p>
                <p className="mt-2 text-[36px] font-normal leading-none text-[#991B1B]">
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
          <NeedsActionLayout anomalies={needsActionAnomalies} />
        </TabsContent>

        {/* All Anomalies Tab */}
        <TabsContent value="all-anomalies" className="space-y-4">
          <AnomalyTable anomalies={anomalies} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AuditDetailPage;
