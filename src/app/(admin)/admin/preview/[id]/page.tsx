import Link from "next/link";
import { notFound } from "next/navigation";
import type { ElementType } from "react";
import {
  ArrowLeft,
  AlertTriangle,
  Users,
  DollarSign,
  FileText,
  Target,
  Clock,
  TrendingDown,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { createAdminClient } from "@/lib/supabase/admin";
import { Anomaly, Audit, AnomalyCategory, AnomalyConfidence } from "@/lib/types/database";
import PublishButton from "@/components/admin/PublishButton";
import { categoryConfig as categoryStyleConfig } from "@/lib/utils/category-config";

type PreviewPageProps = {
  params: Promise<{
    id: string;
  }>;
};

type Organization = {
  id: string;
  name: string;
};

const getMetaString = (metadata: Record<string, unknown> | null, key: string) => {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
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
      month: "long",
      year: "numeric",
    });
  return `${format(start)} - ${format(end)}`;
};

const categoryIconConfig: Record<string, ElementType> = {
  zombie_subscription: Users,
  unbilled_usage: FileText,
  pricing_mismatch: DollarSign,
  duplicate_charge: AlertTriangle,
  failed_payment: AlertTriangle,
  amount_mismatch: Target,
  revenue_leakage: TrendingDown,
  disputed_charge: AlertTriangle,
  fee_discrepancy: AlertTriangle,
  other: AlertTriangle,
};

const confidenceConfig: Record<AnomalyConfidence, { label: string; color: string }> = {
  high: { label: "HIGH", color: "bg-emerald-600 text-white" },
  medium: { label: "MEDIUM", color: "bg-amber-500 text-white" },
  low: { label: "LOW", color: "bg-slate-500 text-white" },
};

const PreviewPage = async ({ params }: PreviewPageProps) => {
  const { id } = await params;

  const supabase = createAdminClient();
  
  if (!supabase) {
    notFound();
  }

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
      "id, category, customer_id, status, confidence, annual_impact, monthly_impact, description, root_cause, recommendation, metadata"
    )
    .eq("audit_id", audit.id)
    .order("annual_impact", { ascending: false })
    .returns<Anomaly[]>();

  const anomalies = anomaliesData ?? [];

  // Calculate category breakdown with impact
  const categoryBreakdown = anomalies.reduce((acc, anomaly) => {
    const category = anomaly.category as AnomalyCategory;
    if (!acc[category]) {
      acc[category] = { count: 0, impact: 0 };
    }
    acc[category].count += 1;
    acc[category].impact += anomaly.annual_impact ?? 0;
    return acc;
  }, {} as Record<string, { count: number; impact: number }>);

  // Get top 5 issues by impact
  const topIssues = anomalies.slice(0, 5);

  // Identify common patterns
  const patterns: { title: string; description: string; percentage: number }[] = [];
  
  const zombieCount = anomalies.filter(a => a.category === "zombie_subscription").length;
  const pricingCount = anomalies.filter(a => a.category === "pricing_mismatch").length;
  const unbilledCount = anomalies.filter(a => a.category === "unbilled_usage").length;
  const duplicateCount = anomalies.filter(a => a.category === "duplicate_charge").length;
  
  if (zombieCount > 0) {
    patterns.push({
      title: "Inactive Subscription Risk",
      description: "Active subscriptions with zero product activity detected. Review webhook reliability and churn detection.",
      percentage: Math.round((zombieCount / anomalies.length) * 100) || 0,
    });
  }
  
  if (pricingCount > 0) {
    patterns.push({
      title: "Pricing & Payment Issues",
      description: "Pricing mismatches, failed payments, or refund issues detected. Review billing configuration and dunning sequences.",
      percentage: Math.round((pricingCount / anomalies.length) * 100) || 0,
    });
  }
  
  if (unbilledCount > 0) {
    patterns.push({
      title: "Billing Gap Issues",
      description: "Usage events not properly invoiced. Review metering pipeline and invoice generation logic.",
      percentage: Math.round((unbilledCount / anomalies.length) * 100) || 0,
    });
  }
  
  if (duplicateCount > 0) {
    patterns.push({
      title: "Duplicate & Dispute Risk",
      description: "Duplicate charges or disputed transactions detected. Implement idempotency keys and review charge logic.",
      percentage: Math.round((duplicateCount / anomalies.length) * 100) || 0,
    });
  }

  const estimatedRecovery = (audit.annual_revenue_at_risk ?? 0) * 0.85;

  const rootCauseRollup = Object.values(
    anomalies.reduce((acc, anomaly) => {
      const key = anomaly.root_cause?.trim() || "Unspecified";
      if (!acc[key]) {
        acc[key] = { label: key, count: 0, impact: 0 };
      }
      acc[key].count += 1;
      acc[key].impact += anomaly.annual_impact ?? 0;
      return acc;
    }, {} as Record<string, { label: string; count: number; impact: number }>)
  )
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 5);

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

        <PublishButton auditId={audit.id} status={audit.status} />
      </div>

      {/* Preview Banner */}
      <div className="rounded-lg border border-amber-600/50 bg-amber-950/50 px-4 py-3 text-sm text-amber-400">
        <strong>Preview Mode:</strong> This is how the client will see their audit report once published.
      </div>

      {/* Client View Preview */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm print:shadow-none">
        
        {/* Report Header */}
        <div className="border-b border-slate-200 bg-gradient-to-r from-slate-900 to-slate-800 px-8 py-10 text-white rounded-t-xl">
          <div className="max-w-4xl">
            <p className="text-sm font-medium uppercase tracking-wider text-slate-400 mb-2">Revenue Audit Report</p>
            <h1 className="text-3xl font-bold mb-2">
              {organization?.name ?? "Organization"}
            </h1>
            <p className="text-slate-400">
              Audit Period: {formatDateRange(audit.audit_period_start, audit.audit_period_end)}
            </p>
            <p className="text-slate-500 text-sm mt-1">
              Report Generated: {new Date(audit.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </p>
          </div>
        </div>

        <div className="p-8">
          {/* Executive Summary */}
          <section className="mb-10">
            <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
              <Target className="h-5 w-5 text-slate-600" />
              Executive Summary
            </h2>
            
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
              <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-500 mb-1">
                  <AlertTriangle className="h-4 w-4" />
                  Total Anomalies
                </div>
                <div className="text-4xl font-bold text-slate-900">
                  {audit.total_anomalies ?? 0}
                </div>
              </div>
              
              <div className="rounded-xl border border-rose-200 bg-gradient-to-br from-rose-50 to-white p-5">
                <div className="flex items-center gap-2 text-sm font-medium text-rose-600 mb-1">
                  <DollarSign className="h-4 w-4" />
                  Annual Revenue at Risk
                </div>
                <div className="text-4xl font-bold text-rose-600">
                  {formatCurrency(audit.annual_revenue_at_risk)}
                </div>
              </div>
              
              <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-500 mb-1">
                  <Clock className="h-4 w-4" />
                  Avg. Detection Time
                </div>
                <div className="text-4xl font-bold text-slate-900">
                  4-7 <span className="text-lg font-normal text-slate-500">mo</span>
                </div>
              </div>
              
              <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5">
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 mb-1">
                  <TrendingDown className="h-4 w-4 rotate-180" />
                  Estimated Recovery
                </div>
                <div className="text-4xl font-bold text-emerald-600">
                  {formatCurrency(estimatedRecovery)}
                </div>
                <div className="text-xs text-emerald-600 mt-1">85-90% recovery rate</div>
              </div>
            </div>
          </section>

          {/* Breakdown by Category */}
          <section className="mb-10">
            <h2 className="text-xl font-bold text-slate-900 mb-6">Breakdown by Category</h2>
            
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Category</th>
                    <th className="px-6 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-600">Count</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-600">Annual Impact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {Object.entries(categoryBreakdown)
                    .sort((a, b) => b[1].impact - a[1].impact)
                    .map(([category, data]) => {
                      const style = categoryStyleConfig[category] ?? categoryStyleConfig.other;
                      const Icon = categoryIconConfig[category] ?? categoryIconConfig.other;
                      return (
                        <tr key={category} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div
                                className="rounded-lg p-2"
                                style={{ backgroundColor: style.bgColor }}
                              >
                                <Icon className="h-4 w-4 text-white" />
                              </div>
                              <span className="font-medium text-slate-900">{style.label}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className="inline-flex items-center justify-center rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
                              {data.count}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className="font-semibold text-rose-600">{formatCurrency(data.impact)}</span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-900 text-white">
                    <td className="px-6 py-4 font-semibold">Total</td>
                    <td className="px-6 py-4 text-center font-semibold">{anomalies.length}</td>
                    <td className="px-6 py-4 text-right font-semibold">{formatCurrency(audit.annual_revenue_at_risk)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* Top Issues */}
          {topIssues.length > 0 && (
            <section className="mb-10">
              <h2 className="text-xl font-bold text-slate-900 mb-6">Top {topIssues.length} Issues (by Financial Impact)</h2>
              
              <div className="space-y-4">
                {topIssues.map((anomaly, index) => {
                  const catStyle =
                    categoryStyleConfig[anomaly.category] ?? categoryStyleConfig.other;
                  const confConfig = confidenceConfig[anomaly.confidence];
                  const Icon = categoryIconConfig[anomaly.category] ?? categoryIconConfig.other;
                  const confidenceReason = getMetaString(anomaly.metadata, "confidence_reason");
                  const impactType = getMetaString(anomaly.metadata, "impact_type");
                  const detectionMethod = getMetaString(anomaly.metadata, "detection_method");
                  
                  return (
                    <div key={anomaly.id} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                      {/* Issue Header */}
                      <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-b border-slate-200">
                        <div className="flex items-center gap-4">
                          <span className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-900 text-white text-sm font-bold">
                            {index + 1}
                          </span>
                          <div className="flex items-center gap-2">
                            <div
                              className="rounded-lg p-1.5"
                              style={{ backgroundColor: catStyle.bgColor }}
                            >
                              <Icon className="h-4 w-4 text-white" />
                            </div>
                            <span className="font-semibold text-slate-900">{catStyle.label}</span>
                          </div>
                          {anomaly.customer_id && (
                            <span className="text-sm text-slate-500">— Customer #{anomaly.customer_id}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${confConfig.color}`}>
                            {confConfig.label}
                          </span>
                          <span className="text-lg font-bold text-rose-600">
                            {formatCurrency(anomaly.annual_impact)}/yr
                          </span>
                        </div>
                      </div>
                      
                      {/* Issue Body */}
                      <div className="px-6 py-5 space-y-4">
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Status</h4>
                          <p className="text-slate-700">{anomaly.description}</p>
                        </div>

                        {(confidenceReason || impactType || detectionMethod) && (
                          <div>
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Evidence</h4>
                            <div className="space-y-1 text-sm text-slate-700">
                              {confidenceReason && (
                                <p>
                                  <span className="font-semibold text-slate-800">Confidence:</span>{" "}
                                  {confidenceReason}
                                </p>
                              )}
                              {impactType && (
                                <p>
                                  <span className="font-semibold text-slate-800">Impact Type:</span>{" "}
                                  {impactType}
                                </p>
                              )}
                              {detectionMethod && (
                                <p>
                                  <span className="font-semibold text-slate-800">Detection:</span>{" "}
                                  {detectionMethod}
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                        
                        {anomaly.monthly_impact && (
                          <div className="flex gap-8">
                            <div>
                              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Monthly Impact</h4>
                              <p className="text-slate-900 font-semibold">{formatCurrency(anomaly.monthly_impact)}/mo</p>
                            </div>
                            <div>
                              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Annual Impact</h4>
                              <p className="text-rose-600 font-semibold">{formatCurrency(anomaly.annual_impact)}</p>
                            </div>
                          </div>
                        )}
                        
                        {anomaly.root_cause && (
                          <div>
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Root Cause</h4>
                            <p className="text-slate-700">{anomaly.root_cause}</p>
                          </div>
                        )}
                        
                        {anomaly.recommendation && (
                          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4">
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-emerald-700 mb-1">Recommendation</h4>
                            <p className="text-emerald-800">{anomaly.recommendation}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              
              {anomalies.length > 5 && (
                <p className="text-center text-sm text-slate-500 mt-4">
                  + {anomalies.length - 5} additional anomalies detected
                </p>
              )}
            </section>
          )}

          {rootCauseRollup.length > 0 && (
            <section className="mb-10">
              <h2 className="text-xl font-bold text-slate-900 mb-6">Root Cause Rollup</h2>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                        Root Cause
                      </th>
                      <th className="px-6 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-600">
                        Count
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-600">
                        Annual Impact
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rootCauseRollup.map((cause) => (
                      <tr key={cause.label} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 text-sm text-slate-700">{cause.label}</td>
                        <td className="px-6 py-4 text-center text-sm font-semibold text-slate-700">
                          {cause.count}
                        </td>
                        <td className="px-6 py-4 text-right text-sm font-semibold text-slate-900">
                          {formatCurrency(cause.impact)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rootCauseRollup.length < anomalies.length && (
                <p className="text-sm text-slate-500 mt-3">
                  Showing top {rootCauseRollup.length} root causes by annual impact.
                </p>
              )}
            </section>
          )}

          {/* Common Patterns */}
          {patterns.length > 0 && (
            <section className="mb-10">
              <h2 className="text-xl font-bold text-slate-900 mb-6">Common Patterns Identified</h2>
              
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {patterns.map((pattern, index) => (
                  <div key={index} className="rounded-xl border border-slate-200 p-5">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-slate-900">{pattern.title}</h3>
                      <span className="text-sm font-bold text-slate-600">{pattern.percentage}%</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 mb-3">
                      <div 
                        className="bg-slate-900 h-2 rounded-full" 
                        style={{ width: `${pattern.percentage}%` }}
                      />
                    </div>
                    <p className="text-sm text-slate-600">{pattern.description}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Methodology */}
          <section className="mb-10">
            <h2 className="text-xl font-bold text-slate-900 mb-6">Methodology</h2>
            
            <div className="grid gap-6 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-5">
                <h3 className="font-semibold text-slate-900 mb-3">Data Sources Analyzed</h3>
                <ul className="space-y-2 text-sm text-slate-600">
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Stripe Payment Records
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Product Usage Logs
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Customer Account Status
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Invoice and Billing History
                  </li>
                </ul>
              </div>
              
              <div className="rounded-xl border border-slate-200 p-5">
                <h3 className="font-semibold text-slate-900 mb-3">Analysis Process</h3>
                <ol className="space-y-2 text-sm text-slate-600 list-decimal list-inside">
                  <li>Cross-reference customer IDs between billing and product data</li>
                  <li>Identify discrepancies (active billing with no usage, usage with no billing)</li>
                  <li>Detect payment failures and churn risk patterns</li>
                  <li>Confidence scoring based on data quality</li>
                </ol>
              </div>
            </div>
          </section>

          {/* Recommended Next Steps */}
          <section>
            <h2 className="text-xl font-bold text-slate-900 mb-6">Recommended Next Steps</h2>
            
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-5">
                <h3 className="font-bold text-rose-800 mb-1">Immediate (This Week)</h3>
                <ul className="space-y-2 text-sm text-rose-700">
                  <li>• Review top 5 anomalies with finance</li>
                  <li>• Begin recovery for high-confidence issues</li>
                  <li>• Contact at-risk customers</li>
                </ul>
              </div>
              
              <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-5">
                <h3 className="font-bold text-amber-800 mb-1">Short-Term (This Month)</h3>
                <ul className="space-y-2 text-sm text-amber-700">
                  <li>• Implement real-time monitoring</li>
                  <li>• Fix billing sync issues</li>
                  <li>• Review dunning sequences</li>
                </ul>
              </div>
              
              <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-5">
                <h3 className="font-bold text-emerald-800 mb-1">Long-Term (Next Quarter)</h3>
                <ul className="space-y-2 text-sm text-emerald-700">
                  <li>• Event-driven billing architecture</li>
                  <li>• Automated reconciliation</li>
                  <li>• Continuous revenue monitoring</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Footer */}
          <div className="mt-12 pt-8 border-t border-slate-200 text-center text-sm text-slate-500">
            <p>This audit was performed by <strong className="text-slate-900">Vynt</strong></p>
            <p className="text-slate-400">Revenue Observability for Modern SaaS</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PreviewPage;
