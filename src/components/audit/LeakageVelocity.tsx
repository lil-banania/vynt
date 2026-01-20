"use client";

import { AlertTriangle, Clock, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LeakageVelocity as LeakageVelocityType } from "@/lib/audit/calculations";
import { formatCurrency } from "@/lib/audit/calculations";

interface LeakageVelocityProps {
  data: LeakageVelocityType;
}

const LeakageVelocity = ({ data }: LeakageVelocityProps) => {
  const urgencyConfig = {
    immediate: {
      bg: 'bg-rose-50',
      border: 'border-rose-500',
      headerBg: 'bg-rose-100',
      icon: AlertTriangle,
      iconColor: 'text-rose-600',
      text: 'text-rose-700',
      badge: 'bg-rose-600 text-white'
    },
    high: {
      bg: 'bg-amber-50',
      border: 'border-amber-500',
      headerBg: 'bg-amber-100',
      icon: Clock,
      iconColor: 'text-amber-600',
      text: 'text-amber-700',
      badge: 'bg-amber-600 text-white'
    },
    medium: {
      bg: 'bg-yellow-50',
      border: 'border-yellow-500',
      headerBg: 'bg-yellow-100',
      icon: TrendingDown,
      iconColor: 'text-yellow-600',
      text: 'text-yellow-700',
      badge: 'bg-yellow-600 text-white'
    }
  }[data.urgency];

  const Icon = urgencyConfig.icon;
  const currentYear = new Date().getFullYear();

  return (
    <Card className={`border-2 ${urgencyConfig.border} ${urgencyConfig.bg}`}>
      <CardHeader className={`pb-2 ${urgencyConfig.headerBg} rounded-t-lg`}>
        <CardTitle className="flex items-center gap-2 text-lg font-bold text-slate-900">
          <Icon className={`h-5 w-5 ${urgencyConfig.iconColor}`} />
          Leakage Velocity
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {/* Key Metrics */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-slate-600">Current Monthly Loss:</p>
            <p className="text-2xl font-bold text-rose-600">
              {formatCurrency(data.monthlyLoss)}
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-600">Projected 12-Month Loss:</p>
            <p className="text-2xl font-bold text-rose-700">
              {formatCurrency(data.projected12MonthLoss)}
            </p>
          </div>
        </div>

        <div>
          <p className="text-sm text-slate-600">Time Since Last Audit:</p>
          <p className="text-lg font-semibold text-slate-800">
            {data.timeSinceLastAudit}
          </p>
        </div>

        {/* Without Action Projections */}
        <div className="border-t border-slate-300 pt-3">
          <p className="mb-2 flex items-center gap-2 font-semibold text-slate-700">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            WITHOUT ACTION:
          </p>
          <ul className="ml-6 space-y-1 text-sm text-slate-700">
            {data.withoutAction.q1 > 0 && (
              <li>• Q1 {currentYear}: {formatCurrency(data.withoutAction.q1)} additional loss</li>
            )}
            {data.withoutAction.q2 > 0 && (
              <li>• Q2 {currentYear}: {formatCurrency(data.withoutAction.q2)} cumulative</li>
            )}
            <li className="font-medium">
              • FY {currentYear}: {formatCurrency(data.withoutAction.fy)} total
            </li>
          </ul>
        </div>

        {/* Urgency Badge */}
        <div className="border-t border-slate-300 pt-3">
          <div className="flex items-center gap-2">
            <Clock className={`h-5 w-5 ${urgencyConfig.iconColor}`} />
            <span className="font-bold text-slate-700">Action Required:</span>
            <span className={`rounded-full px-3 py-1 text-sm font-bold ${urgencyConfig.badge}`}>
              {data.urgency.toUpperCase()}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default LeakageVelocity;
