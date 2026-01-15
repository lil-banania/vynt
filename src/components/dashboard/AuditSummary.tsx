import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Audit } from "@/lib/types/database";

type AuditSummaryProps = {
  audit: Audit & { organization_name?: string };
  anomalyCounts: {
    zombie_subscription: number;
    unbilled_usage: number;
    pricing_mismatch: number;
    duplicate_charge: number;
  };
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

const formatDateRange = (start: string, end: string) => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const format = (date: Date) =>
    date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  return `${format(startDate)} - ${format(endDate)}`;
};

const AuditSummary = ({ audit, anomalyCounts }: AuditSummaryProps) => {
  const totalAnomalies =
    anomalyCounts.zombie_subscription +
    anomalyCounts.unbilled_usage +
    anomalyCounts.pricing_mismatch +
    anomalyCounts.duplicate_charge;

  const categoryRows = [
    {
      key: "zombie_subscription",
      label: "Zombie Subscriptions",
      value: anomalyCounts.zombie_subscription,
      color: "bg-red-500",
    },
    {
      key: "unbilled_usage",
      label: "Unbilled Usage",
      value: anomalyCounts.unbilled_usage,
      color: "bg-orange-500",
    },
    {
      key: "pricing_mismatch",
      label: "Pricing Mismatch",
      value: anomalyCounts.pricing_mismatch,
      color: "bg-yellow-400",
    },
    {
      key: "duplicate_charge",
      label: "Duplicate Charge",
      value: anomalyCounts.duplicate_charge,
      color: "bg-blue-500",
    },
  ];

  const maxValue = Math.max(1, ...categoryRows.map((row) => row.value));

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="space-y-2">
          <CardTitle className="text-2xl font-semibold text-slate-900">
            {audit.organization_name ?? "Organization"}
          </CardTitle>
          <p className="text-sm text-slate-500">
            {audit.audit_period_start && audit.audit_period_end
              ? formatDateRange(
                  audit.audit_period_start,
                  audit.audit_period_end
                )
              : "Audit period"}
          </p>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Total Anomalies Detected
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-slate-900">
            {totalAnomalies}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Annual Revenue at Risk
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-slate-900">
            {formatCurrency(audit.annual_revenue_at_risk)}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Average Time to Detection
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-slate-900">
            4-7 months
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Estimated Recovery Rate
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-slate-900">
            85-90%
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-slate-900">
            Breakdown by Category
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {categoryRows.map((row) => (
            <div key={row.key} className="space-y-2">
              <div className="flex items-center justify-between text-sm text-slate-600">
                <span>{row.label}</span>
                <span className="font-medium text-slate-900">{row.value}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100">
                <div
                  className={`h-2 rounded-full ${row.color}`}
                  style={{ width: `${(row.value / maxValue) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default AuditSummary;