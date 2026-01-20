import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, DollarSign, Users, FileText, Target, ArrowLeft, Sparkles } from "lucide-react";

import AuditSummary from "@/components/dashboard/AuditSummary";
import AnomalyTable from "@/components/dashboard/AnomalyTable";
import ExportPdfButton from "@/components/dashboard/ExportPdfButton";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { Anomaly, Audit, Profile, AnomalyCategory, AnomalyConfidence } from "@/lib/types/database";

// New CFO-ready components
import FinancialImpactSummary from "@/components/audit/FinancialImpactSummary";
import RecoveryPriorityMatrix from "@/components/audit/RecoveryPriorityMatrix";
import IndustryBenchmark from "@/components/audit/IndustryBenchmark";
import LeakageVelocity from "@/components/audit/LeakageVelocity";
import EnhancedRootCause from "@/components/audit/EnhancedRootCause";
import ConfidenceBadge from "@/components/audit/ConfidenceBadge";

// Calculation utilities
import { calculateFinancialImpact, calculateVelocity, formatCustomerDisplay } from "@/lib/audit/calculations";
import { groupByPriority } from "@/lib/audit/prioritization";
import { calculateBenchmark } from "@/lib/audit/benchmarking";
import { getRootCauseTemplate } from "@/lib/audit/root-cause-templates";

type AuditDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

type Organization = {
  id: string;
  name: string;
};

type AuditWithExtras = Audit & { 
  ai_insights?: string | null;
  total_arr?: number | null;
  company_vertical?: string | null;
  previous_audit_date?: string | null;
};

const formatCurrency = (value: number | null) => {
  if (value === null) return "$0";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
};

const categoryConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  zombie_subscription: { label: "Zombie Subscription", color: "bg-rose-500", icon: Users },
  unbilled_usage: { label: "Unbilled Usage", color: "bg-amber-500", icon: FileText },
  pricing_mismatch: { label: "Pricing Mismatch", color: "bg-purple-500", icon: DollarSign },
  duplicate_charge: { label: "Duplicate Charge", color: "bg-orange-500", icon: AlertTriangle },
  failed_payment: { label: "Failed Payment", color: "bg-red-500", icon: AlertTriangle },
  high_refund_rate: { label: "High Refund Rate", color: "bg-yellow-500", icon: AlertTriangle },
  missing_in_stripe: { label: "Missing in Stripe", color: "bg-blue-500", icon: AlertTriangle },
  missing_in_db: { label: "Missing in DB", color: "bg-cyan-500", icon: AlertTriangle },
  amount_mismatch: { label: "Amount Mismatch", color: "bg-indigo-500", icon: Target },
  revenue_leakage: { label: "Revenue Leakage", color: "bg-pink-500", icon: DollarSign },
  disputed_charge: { label: "Disputed Charge", color: "bg-fuchsia-500", icon: AlertTriangle },
  fee_discrepancy: { label: "Fee Discrepancy", color: "bg-lime-500", icon: AlertTriangle },
  other: { label: "Other", color: "bg-slate-500", icon: AlertTriangle },
};

const confidenceConfig: Record<AnomalyConfidence, { label: string; color: string }> = {
  high: { label: "HIGH", color: "bg-emerald-600 text-white" },
  medium: { label: "MEDIUM", color: "bg-amber-500 text-white" },
  low: { label: "LOW", color: "bg-slate-500 text-white" },
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
      "id, organization_id, status, audit_period_start, audit_period_end, total_anomalies, annual_revenue_at_risk, ai_insights, created_at, published_at, created_by, total_arr, company_vertical, previous_audit_date"
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
  if (audit.status === "processing" || audit.status === "pending" || audit.status === "draft") {
    redirect(`/audit/${id}/processing`);
  }

  // Only show completed audits (review or published) to clients
  if (audit.status !== "published" && audit.status !== "review") {
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
      "id, audit_id, category, customer_id, status, confidence, annual_impact, monthly_impact, description, root_cause, recommendation, metadata, detected_at, confidence_score, customer_name, customer_tier"
    )
    .eq("audit_id", audit.id)
    .order("annual_impact", { ascending: false })
    .returns<(Anomaly & { confidence_score?: number; customer_name?: string; customer_tier?: string })[]>();

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

  // ============================================================================
  // CFO-READY CALCULATIONS
  // ============================================================================
  
  const totalRevenueAtRisk = audit.annual_revenue_at_risk ?? 0;
  const totalARR = audit.total_arr ?? 10_000_000; // Default to $10M ARR if not set
  const vertical = audit.company_vertical ?? 'DevTools';
  
  // Financial Impact
  const financialImpact = calculateFinancialImpact(totalRevenueAtRisk, totalARR);
  
  // Priority Matrix
  const priorityTiers = groupByPriority(anomalies);
  
  // Industry Benchmark
  const benchmark = calculateBenchmark(totalRevenueAtRisk, totalARR, vertical);
  
  // Leakage Velocity
  const previousAuditDate = audit.previous_audit_date ? new Date(audit.previous_audit_date) : null;
  const velocity = calculateVelocity(totalRevenueAtRisk, previousAuditDate);

  // Identify common patterns
  const patterns: { title: string; description: string; percentage: number }[] = [];
  
  const zombieCount = anomalies.filter(a => a.category === "zombie_subscription").length;
  const pricingCount = anomalies.filter(a => a.category === "pricing_mismatch").length;
  const unbilledCount = anomalies.filter(a => a.category === "unbilled_usage").length;
  const duplicateCount = anomalies.filter(a => a.category === "duplicate_charge").length;
  
  if (zombieCount > 0 && anomalies.length > 0) {
    patterns.push({
      title: "Inactive Subscription Risk",
      description: "Active subscriptions with zero product activity. Review webhook reliability and churn detection.",
      percentage: Math.round((zombieCount / anomalies.length) * 100),
    });
  }
  
  if (pricingCount > 0 && anomalies.length > 0) {
    patterns.push({
      title: "Pricing & Payment Issues",
      description: "Pricing mismatches, failed payments, or refund issues. Review billing configuration and dunning sequences.",
      percentage: Math.round((pricingCount / anomalies.length) * 100),
    });
  }
  
  if (unbilledCount > 0 && anomalies.length > 0) {
    patterns.push({
      title: "Billing Gap Issues",
      description: "Usage events not properly invoiced. Review metering pipeline and invoice generation.",
      percentage: Math.round((unbilledCount / anomalies.length) * 100),
    });
  }
  
  if (duplicateCount > 0 && anomalies.length > 0) {
    patterns.push({
      title: "Duplicate & Dispute Risk",
      description: "Duplicate charges or disputed transactions. Implement idempotency keys and review charge logic.",
      percentage: Math.round((duplicateCount / anomalies.length) * 100),
    });
  }

  return (
    <div className="space-y-8 print:space-y-6">
      {/* Header Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button asChild variant="outline" className="border-slate-300">
          <Link href="/dashboard">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to My Audits
          </Link>
        </Button>

        <ExportPdfButton />
      </div>

      {/* Audit Summary (Header + Executive Summary + Breakdown) */}
      <AuditSummary
        audit={{
          ...audit,
          organization_name: organization?.name,
        }}
        categoryBreakdown={categoryBreakdown}
      />

      {/* 🔴 PRIORITY 1: Financial Impact Summary */}
      <section className="print:break-inside-avoid">
        <FinancialImpactSummary data={financialImpact} />
      </section>

      {/* AI Executive Summary */}
      {audit.ai_insights && (
        <section className="print:break-inside-avoid">
          <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-6">
            <h2 className="text-xl font-bold text-blue-900 mb-3 flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              AI Executive Summary
            </h2>
            <p className="text-blue-800 leading-relaxed whitespace-pre-wrap">
              {audit.ai_insights}
            </p>
          </div>
        </section>
      )}

      {/* 🟡 PRIORITY 2: Recovery Priority Matrix */}
      <section className="print:break-inside-avoid">
        <RecoveryPriorityMatrix tiers={priorityTiers} />
      </section>

      {/* 🟢 PRIORITY 5: Industry Benchmarking */}
      <section className="print:break-inside-avoid">
        <IndustryBenchmark data={benchmark} vertical={vertical} />
      </section>

      {/* 🟢 PRIORITY 6: Leakage Velocity */}
      <section className="print:break-inside-avoid">
        <LeakageVelocity data={velocity} />
      </section>

      {/* Top Issues Section with Enhanced Root Cause */}
      {topIssues.length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Target className="h-5 w-5 text-slate-600" />
            Top {topIssues.length} Issues (by Financial Impact)
          </h2>
          
          <div className="space-y-6">
            {topIssues.map((anomaly, index) => {
              const catConfig = categoryConfig[anomaly.category] ?? categoryConfig.other;
              const confConfig = confidenceConfig[anomaly.confidence];
              const Icon = catConfig.icon;
              const rootCause = getRootCauseTemplate(anomaly);
              const confidenceScore = (anomaly as { confidence_score?: number }).confidence_score ?? 
                (anomaly.confidence === 'high' ? 90 : anomaly.confidence === 'medium' ? 70 : 50);
              
              return (
                <div key={anomaly.id} className="rounded-xl border border-slate-200 bg-white overflow-hidden print:break-inside-avoid">
                  {/* Issue Header */}
                  <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-b border-slate-200">
                    <div className="flex items-center gap-4">
                      <span className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-900 text-white text-sm font-bold">
                        {index + 1}
                      </span>
                      <div className="flex items-center gap-2">
                        <div className={`rounded-lg p-1.5 ${catConfig.color}`}>
                          <Icon className="h-4 w-4 text-white" />
                        </div>
                        <span className="font-semibold text-slate-900">{catConfig.label}</span>
                      </div>
                      {anomaly.customer_id && (
                        <span className="text-sm text-slate-500">
                          — {formatCustomerDisplay(
                            anomaly.customer_id,
                            (anomaly as { customer_name?: string }).customer_name,
                            (anomaly as { customer_tier?: string }).customer_tier
                          )}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <ConfidenceBadge score={confidenceScore} />
                      <span className="text-lg font-bold text-rose-600">
                        {formatCurrency(anomaly.annual_impact)}/yr
                      </span>
                    </div>
                  </div>
                  
                  {/* Issue Body */}
                  <div className="px-6 py-5 space-y-4">
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Description</h4>
                      <p className="text-slate-700">{anomaly.description}</p>
                    </div>
                    
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
                    
                    {/* 🟢 PRIORITY 7: Enhanced Root Cause */}
                    <EnhancedRootCause rootCause={rootCause} />
                  </div>
                </div>
              );
            })}
          </div>
          
          {anomalies.length > 5 && (
            <p className="text-center text-sm text-slate-500 mt-4">
              + {anomalies.length - 5} additional anomalies detected (see full list below)
            </p>
          )}
        </section>
      )}

      {/* Common Patterns */}
      {patterns.length > 0 && (
        <section>
          <h2 className="text-xl font-bold text-slate-900 mb-4">Common Patterns Identified</h2>
          
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {patterns.map((pattern, index) => (
              <div key={index} className="rounded-xl border border-slate-200 bg-white p-5">
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

      {/* Full Anomaly List */}
      {anomalies.length > 0 && (
        <section className="print:hidden">
          <h2 className="text-xl font-bold text-slate-900 mb-4">All Detected Anomalies</h2>
          <AnomalyTable anomalies={anomalies} />
        </section>
      )}

      {/* Recommended Next Steps */}
      <section className="print:break-inside-avoid">
        <h2 className="text-xl font-bold text-slate-900 mb-4">Recommended Next Steps</h2>
        
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border-2 border-rose-200 bg-rose-50 p-5">
            <h3 className="font-bold text-rose-800 mb-2">⚡ Immediate (This Week)</h3>
            <ul className="space-y-2 text-sm text-rose-700">
              <li>• Review top 5 anomalies with finance</li>
              <li>• Begin recovery for high-confidence issues</li>
              <li>• Contact at-risk customers</li>
            </ul>
          </div>
          
          <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-5">
            <h3 className="font-bold text-amber-800 mb-2">📅 Short-Term (This Month)</h3>
            <ul className="space-y-2 text-sm text-amber-700">
              <li>• Implement real-time monitoring</li>
              <li>• Fix billing sync issues</li>
              <li>• Review dunning sequences</li>
            </ul>
          </div>
          
          <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-5">
            <h3 className="font-bold text-emerald-800 mb-2">🎯 Long-Term (Next Quarter)</h3>
            <ul className="space-y-2 text-sm text-emerald-700">
              <li>• Event-driven billing architecture</li>
              <li>• Automated reconciliation</li>
              <li>• Continuous revenue monitoring</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Methodology */}
      <section className="print:break-inside-avoid">
        <h2 className="text-xl font-bold text-slate-900 mb-4">Methodology</h2>
        
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
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
          
          <div className="rounded-xl border border-slate-200 bg-white p-5">
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

      {/* Footer */}
      <div className="pt-8 border-t border-slate-200 text-center text-sm text-slate-500">
        <p>This audit was performed by <strong className="text-slate-900">Vynt</strong></p>
        <p className="text-slate-400">Revenue Observability for Modern SaaS</p>
      </div>
    </div>
  );
};

export default AuditDetailPage;
