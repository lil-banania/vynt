"use client";

import { getConfidenceLabel } from "@/lib/audit/calculations";

interface ConfidenceBadgeProps {
  score: number;
  showPercentage?: boolean;
}

const ConfidenceBadge = ({ score, showPercentage = true }: ConfidenceBadgeProps) => {
  const label = getConfidenceLabel(score);
  
  const config = {
    high: {
      bg: 'bg-emerald-100',
      text: 'text-emerald-800',
      border: 'border-emerald-300',
      icon: '🟢'
    },
    medium: {
      bg: 'bg-amber-100',
      text: 'text-amber-800',
      border: 'border-amber-300',
      icon: '🟡'
    },
    low: {
      bg: 'bg-rose-100',
      text: 'text-rose-800',
      border: 'border-rose-300',
      icon: '🔴'
    }
  }[label];
  
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${config.bg} ${config.text} ${config.border}`}>
      <span>{config.icon}</span>
      <span>
        {label.toUpperCase()} CONFIDENCE
        {showPercentage && `: ${score}%`}
      </span>
    </span>
  );
};

export default ConfidenceBadge;
