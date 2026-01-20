import { Anomaly } from "@/lib/types/database";

// ============================================================================
// PRIORITY MATRIX
// ============================================================================

export interface PrioritizedAnomaly extends Anomaly {
  priorityScore: number;
  priorityLevel: 'high' | 'medium' | 'low';
}

export interface PriorityTier {
  level: 'high' | 'medium' | 'low';
  label: string;
  timeframe: string;
  anomalies: PrioritizedAnomaly[];
  totalImpact: number;
  percentageOfTotal: number;
}

export const calculatePriorityScore = (anomaly: Anomaly): number => {
  const impact = anomaly.annual_impact ?? 0;
  
  const impactScore = 
    impact > 40000 ? 3 : 
    impact > 15000 ? 2 : 1;
  
  const confidenceScore = 
    anomaly.confidence === 'high' ? 3 : 
    anomaly.confidence === 'medium' ? 2 : 1;
  
  return impactScore + confidenceScore;
};

export const getPriorityLevel = (score: number): 'high' | 'medium' | 'low' => {
  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
};

export const groupByPriority = (anomalies: Anomaly[]): PriorityTier[] => {
  const totalImpact = anomalies.reduce((sum, a) => sum + (a.annual_impact ?? 0), 0);
  
  const prioritized: PrioritizedAnomaly[] = anomalies.map(a => ({
    ...a,
    priorityScore: calculatePriorityScore(a),
    priorityLevel: getPriorityLevel(calculatePriorityScore(a))
  }));
  
  const high = prioritized.filter(a => a.priorityLevel === 'high');
  const medium = prioritized.filter(a => a.priorityLevel === 'medium');
  const low = prioritized.filter(a => a.priorityLevel === 'low');
  
  const calculateTotalImpact = (items: PrioritizedAnomaly[]) => 
    items.reduce((sum, a) => sum + (a.annual_impact ?? 0), 0);
  
  return [
    {
      level: 'high',
      label: 'HIGH PRIORITY',
      timeframe: 'Act This Week',
      anomalies: high.sort((a, b) => (b.annual_impact ?? 0) - (a.annual_impact ?? 0)),
      totalImpact: calculateTotalImpact(high),
      percentageOfTotal: totalImpact > 0 ? (calculateTotalImpact(high) / totalImpact) * 100 : 0
    },
    {
      level: 'medium',
      label: 'MEDIUM PRIORITY',
      timeframe: 'This Month',
      anomalies: medium.sort((a, b) => (b.annual_impact ?? 0) - (a.annual_impact ?? 0)),
      totalImpact: calculateTotalImpact(medium),
      percentageOfTotal: totalImpact > 0 ? (calculateTotalImpact(medium) / totalImpact) * 100 : 0
    },
    {
      level: 'low',
      label: 'LOW PRIORITY',
      timeframe: 'Next Quarter',
      anomalies: low.sort((a, b) => (b.annual_impact ?? 0) - (a.annual_impact ?? 0)),
      totalImpact: calculateTotalImpact(low),
      percentageOfTotal: totalImpact > 0 ? (calculateTotalImpact(low) / totalImpact) * 100 : 0
    }
  ];
};
