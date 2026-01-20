"use client";

import { BarChart3, TrendingUp, Award } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BenchmarkData, PERCENTILE_THRESHOLDS, getPercentileLabel } from "@/lib/audit/benchmarking";
import { formatCurrency } from "@/lib/audit/calculations";

interface IndustryBenchmarkProps {
  data: BenchmarkData;
  vertical?: string;
}

const IndustryBenchmark = ({ data, vertical = "DevTools" }: IndustryBenchmarkProps) => {
  const percentileLabel = getPercentileLabel(data.yourPercentile);
  const isBetterThanAverage = data.yourLeakageRate < data.industryAverage;
  
  const percentiles = [
    { label: '90th %ile', value: PERCENTILE_THRESHOLDS['90th'], isYou: false, isBestInClass: true },
    { label: '75th %ile', value: PERCENTILE_THRESHOLDS['75th'], isYou: false },
    { label: '50th %ile', value: PERCENTILE_THRESHOLDS['50th'], isIndustryAvg: true, isYou: false },
    { label: '25th %ile', value: PERCENTILE_THRESHOLDS['25th'], isYou: false },
    { label: 'Your Co', value: data.yourLeakageRate, isYou: true }
  ].sort((a, b) => a.value - b.value);

  const maxValue = 5.0;

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
          <BarChart3 className="h-5 w-5" />
          Industry Benchmarking
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Key Metrics */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <p className="text-sm text-slate-500">Your Leakage Rate</p>
            <p className={`text-xl font-bold ${isBetterThanAverage ? 'text-emerald-600' : 'text-rose-600'}`}>
              {data.yourLeakageRate}%
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-slate-500">Industry Average ({vertical})</p>
            <p className="text-xl font-bold text-slate-700">{data.industryAverage}%</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-slate-500">Best-in-Class</p>
            <p className="text-xl font-bold text-emerald-600">{data.bestInClass}%</p>
          </div>
        </div>

        {/* Performance Summary */}
        <div className={`rounded-lg p-3 ${isBetterThanAverage ? 'bg-emerald-50' : 'bg-amber-50'}`}>
          <div className="flex items-center gap-2">
            {isBetterThanAverage ? (
              <Award className="h-5 w-5 text-emerald-600" />
            ) : (
              <TrendingUp className="h-5 w-5 text-amber-600" />
            )}
            <p className={`font-medium ${isBetterThanAverage ? 'text-emerald-800' : 'text-amber-800'}`}>
              Your Performance: {percentileLabel} - Better than {100 - data.yourPercentile}% of peers
            </p>
          </div>
        </div>

        {/* Percentile Chart */}
        <div>
          <p className="mb-2 text-sm font-medium text-slate-600">📊 Percentile Distribution:</p>
          <div className="space-y-2 font-mono text-sm">
            {percentiles.map((p, idx) => {
              const barWidth = Math.min((p.value / maxValue) * 100, 100);
              
              return (
                <div key={idx} className="flex items-center gap-2">
                  <span className="w-20 text-right text-xs text-slate-600">{p.label}:</span>
                  <span className="w-10 text-right text-xs">{p.value}%</span>
                  <div className="flex flex-1 items-center gap-2">
                    <div 
                      className={`h-2 rounded ${p.isYou ? 'bg-blue-500' : p.isBestInClass ? 'bg-emerald-400' : 'bg-slate-300'}`}
                      style={{ width: `${barWidth}%` }}
                    />
                    {p.isIndustryAvg && (
                      <span className="text-xs text-slate-500">← Industry Avg</span>
                    )}
                    {p.isYou && (
                      <span className="text-xs font-semibold text-blue-600">← You</span>
                    )}
                    {p.isBestInClass && !p.isYou && (
                      <span className="text-xs text-emerald-600">★ Best</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Improvement Opportunity */}
        {(data.improvementOpportunity.to75thPercentile > 0 || data.improvementOpportunity.toBestInClass > 0) && (
          <div className="border-t border-slate-200 pt-3">
            <p className="mb-2 text-sm font-medium text-slate-600">Improvement Opportunity:</p>
            <ul className="space-y-1 text-sm text-slate-700">
              {data.improvementOpportunity.to75thPercentile > 0 && (
                <li>
                  • Reach 75th percentile (1.5%):{" "}
                  <span className="font-semibold text-emerald-600">
                    {formatCurrency(data.improvementOpportunity.to75thPercentile)} additional recovery
                  </span>
                </li>
              )}
              {data.improvementOpportunity.toBestInClass > 0 && (
                <li>
                  • Reach best-in-class (0.8%):{" "}
                  <span className="font-semibold text-emerald-600">
                    {formatCurrency(data.improvementOpportunity.toBestInClass)} additional recovery
                  </span>
                </li>
              )}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default IndustryBenchmark;
