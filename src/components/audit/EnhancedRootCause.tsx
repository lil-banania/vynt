"use client";

import { Info, Wrench, Clock, DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EnhancedRootCause as EnhancedRootCauseType } from "@/lib/audit/root-cause-templates";
import { formatCurrency } from "@/lib/audit/calculations";
import ConfidenceBadge from "./ConfidenceBadge";

interface EnhancedRootCauseProps {
  rootCause: EnhancedRootCauseType;
}

const EnhancedRootCause = ({ rootCause }: EnhancedRootCauseProps) => {
  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <Info className="h-5 w-5" />
            Root Cause Analysis
          </CardTitle>
          <ConfidenceBadge score={rootCause.confidence} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Description */}
        <p className="text-slate-700">{rootCause.description}</p>

        {/* Technical Details */}
        {rootCause.technicalDetails && Object.keys(rootCause.technicalDetails).length > 0 && (
          <div>
            <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Wrench className="h-4 w-4" />
              TECHNICAL DETAILS:
            </h4>
            <ul className="space-y-1 text-sm text-slate-600">
              {Object.entries(rootCause.technicalDetails).map(([key, value]) => (
                <li key={key} className="flex">
                  <span className="font-medium text-slate-700">• {key}:</span>
                  <span className="ml-1">{value}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Recommended Fix */}
        <div>
          <h4 className="mb-2 text-sm font-semibold text-slate-700">
            RECOMMENDED FIX:
          </h4>
          <ol className="list-inside list-decimal space-y-1 text-sm text-slate-600">
            {rootCause.recommendedFix.map((fix, idx) => (
              <li key={idx}>{fix}</li>
            ))}
          </ol>
        </div>

        {/* Footer Stats */}
        <div className="flex flex-wrap justify-between gap-4 border-t border-slate-200 pt-3 text-sm">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-400" />
            <span className="text-slate-600">Estimated fix time:</span>
            <span className="font-medium text-slate-800">{rootCause.estimatedFixTime}</span>
          </div>
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-emerald-500" />
            <span className="text-slate-600">Recovery potential:</span>
            <span className="font-medium text-emerald-700">
              {formatCurrency(rootCause.recoveryPotential)}/year
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default EnhancedRootCause;
