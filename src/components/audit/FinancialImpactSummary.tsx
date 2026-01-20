"use client";

import { TrendingUp, DollarSign, Calculator, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FinancialImpactData, formatCurrency } from "@/lib/audit/calculations";

interface FinancialImpactSummaryProps {
  data: FinancialImpactData;
}

const FinancialImpactSummary = ({ data }: FinancialImpactSummaryProps) => {
  const isPositiveROI = data.roi > 0;
  const isStrongROI = data.roi >= 2.0;

  return (
    <Card className="border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg font-bold text-emerald-900">
          <Calculator className="h-5 w-5" />
          Financial Impact Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {/* Total Revenue at Risk */}
          <div className="space-y-1">
            <p className="text-sm text-slate-600">Total Revenue at Risk</p>
            <p className="text-2xl font-bold text-rose-600">
              {formatCurrency(data.totalRevenueAtRisk)}
            </p>
          </div>

          {/* Estimated Recoverable */}
          <div className="space-y-1">
            <p className="text-sm text-slate-600">Estimated Recoverable (85%)</p>
            <p className="text-2xl font-bold text-emerald-600">
              {formatCurrency(data.estimatedRecoverable)}
            </p>
          </div>

          {/* Vynt Annual Cost */}
          <div className="space-y-1">
            <p className="text-sm text-slate-600">Vynt Annual Cost</p>
            <p className="text-2xl font-bold text-slate-700">
              {formatCurrency(data.vyntAnnualCost)}
            </p>
          </div>

          {/* Net Benefit Year 1 */}
          <div className="space-y-1">
            <p className="text-sm text-slate-600">Net Benefit Year 1</p>
            <p className={`text-2xl font-bold ${isPositiveROI ? 'text-emerald-600' : 'text-rose-600'}`}>
              {formatCurrency(data.netBenefitYear1)}
            </p>
          </div>

          {/* ROI */}
          <div className="space-y-1">
            <p className="text-sm text-slate-600">ROI</p>
            <div className="flex items-center gap-2">
              <p className={`text-2xl font-bold ${isStrongROI ? 'text-emerald-600' : isPositiveROI ? 'text-amber-600' : 'text-rose-600'}`}>
                {data.roi.toFixed(1)}x
              </p>
              {isStrongROI && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  <TrendingUp className="h-3 w-3" />
                  Strong
                </span>
              )}
            </div>
          </div>

          {/* Payback Period */}
          <div className="space-y-1">
            <p className="text-sm text-slate-600">Payback Period</p>
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-slate-400" />
              <p className="text-2xl font-bold text-slate-700">
                {data.paybackPeriodMonths.toFixed(1)} months
              </p>
            </div>
          </div>
        </div>

        {/* Summary Banner */}
        {isPositiveROI && (
          <div className="mt-4 rounded-lg bg-emerald-100 p-3 text-center">
            <p className="text-sm font-medium text-emerald-800">
              <DollarSign className="inline h-4 w-4" />
              For every $1 spent on Vynt, you recover{" "}
              <span className="font-bold">${(data.roi + 1).toFixed(2)}</span> in year one
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default FinancialImpactSummary;
