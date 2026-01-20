"use client";

import { Zap, Calendar, Target, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RecommendedActions as RecommendedActionsType } from "@/lib/audit/actions-generator";
import { formatCurrency } from "@/lib/audit/calculations";

interface RecommendedActionsProps {
  actions: RecommendedActionsType;
}

interface ActionSectionProps {
  title: string;
  icon: React.ReactNode;
  items: { task: string; completed: boolean }[];
}

const ActionSection = ({ title, icon, items }: ActionSectionProps) => {
  if (items.length === 0) return null;
  
  return (
    <div>
      <h4 className="mb-2 flex items-center gap-2 font-semibold text-slate-700">
        {icon}
        {title}
      </h4>
      <ul className="ml-1 space-y-1.5">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-start gap-2">
            {item.completed ? (
              <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
            ) : (
              <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border border-slate-300 text-slate-400">
                ☐
              </span>
            )}
            <span className={`text-sm ${item.completed ? 'text-slate-500 line-through' : 'text-slate-700'}`}>
              {item.task}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const RecommendedActions = ({ actions }: RecommendedActionsProps) => {
  const hourlyROI = actions.estimatedEffort > 0 
    ? actions.annualImpact / actions.estimatedEffort 
    : 0;
  
  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-bold text-slate-900">
          Recommended Actions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ActionSection 
          title="IMMEDIATE (Next 24 Hours)" 
          icon={<Zap className="h-4 w-4 text-amber-500" />}
          items={actions.immediate}
        />
        
        <ActionSection 
          title="SHORT-TERM (This Week)" 
          icon={<Calendar className="h-4 w-4 text-blue-500" />}
          items={actions.shortTerm}
        />
        
        <ActionSection 
          title="LONG-TERM (This Month)" 
          icon={<Target className="h-4 w-4 text-purple-500" />}
          items={actions.longTerm}
        />
        
        <div className="space-y-1 border-t border-slate-200 pt-4 text-sm text-slate-700">
          <p>
            <span className="font-medium">Owner:</span>{" "}
            {actions.owner.join(" + ")}
          </p>
          <p>
            <span className="font-medium">Timeline:</span>{" "}
            {actions.timeline}
          </p>
          <p>
            <span className="font-medium">Effort:</span>{" "}
            {actions.estimatedEffort} hours
          </p>
          <p className="text-base font-semibold text-emerald-700">
            ROI: {formatCurrency(actions.annualImpact)}/year ÷ {actions.estimatedEffort} hours
            = {formatCurrency(hourlyROI)}/hour
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

export default RecommendedActions;
