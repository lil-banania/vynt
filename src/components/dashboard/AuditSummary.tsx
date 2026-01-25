import type { ElementType } from "react";
import { AlertTriangle, Clock, DollarSign, TrendingUp, Users, FileText } from "lucide-react";

import { Audit } from "@/lib/types/database";
import { categoryConfig as categoryStyleConfig } from "@/lib/utils/category-config";

type CategoryData = {
  count: number;
  impact: number;
};

type AuditSummaryProps = {
  audit: Audit & { organization_name?: string };
  categoryBreakdown: Record<string, CategoryData>;
};

const formatCurrency = (value: number | null) => {
  if (value === null) {
    return "$0";
  }
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
  disputed_charge: AlertTriangle,
  fee_discrepancy: AlertTriangle,
  other: AlertTriangle,
};

const AuditSummary = ({ audit, categoryBreakdown }: AuditSummaryProps) => {
  const totalAnomalies = Object.values(categoryBreakdown).reduce((sum, cat) => sum + cat.count, 0);
  const estimatedRecovery = (audit.annual_revenue_at_risk ?? 0) * 0.85;

  return (
    <div className="space-y-8">
      {/* Report Header */}
      <div className="rounded-xl border border-slate-200 bg-gradient-to-r from-slate-900 to-slate-800 px-8 py-10 text-white">
        <p className="text-sm font-medium uppercase tracking-wider text-slate-400 mb-2">Revenue Audit Report</p>
        <h1 className="text-3xl font-bold mb-2">
          {audit.organization_name ?? "Organization"}
        </h1>
        <p className="text-slate-400">
          Audit Period: {formatDateRange(audit.audit_period_start, audit.audit_period_end)}
        </p>
        {audit.published_at && (
          <p className="text-slate-500 text-sm mt-1">
            Published: {new Date(audit.published_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </p>
        )}
      </div>

      {/* Executive Summary Cards */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-slate-600" />
          Executive Summary
        </h2>
        
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-500 mb-1">
              <AlertTriangle className="h-4 w-4" />
              Total Anomalies
            </div>
            <div className="text-4xl font-bold text-slate-900">
              {totalAnomalies}
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
              <TrendingUp className="h-4 w-4" />
              Estimated Recovery
            </div>
            <div className="text-4xl font-bold text-emerald-600">
              {formatCurrency(estimatedRecovery)}
            </div>
            <div className="text-xs text-emerald-600 mt-1">85-90% recovery rate</div>
          </div>
        </div>
      </div>

      {/* Breakdown by Category */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 mb-4">Breakdown by Category</h2>
        
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">Category</th>
                <th className="px-6 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-600">Count</th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-600">Annual Impact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {Object.entries(categoryBreakdown)
                .filter(([, data]) => data.count > 0)
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
                <td className="px-6 py-4 text-center font-semibold">{totalAnomalies}</td>
                <td className="px-6 py-4 text-right font-semibold">{formatCurrency(audit.annual_revenue_at_risk)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AuditSummary;
