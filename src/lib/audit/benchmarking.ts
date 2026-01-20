// ============================================================================
// INDUSTRY BENCHMARKING
// ============================================================================

export interface BenchmarkData {
  yourLeakageRate: number;
  industryAverage: number;
  bestInClass: number;
  yourPercentile: number;
  improvementOpportunity: {
    to75thPercentile: number;
    toBestInClass: number;
  };
}

export const INDUSTRY_AVERAGES: Record<string, number> = {
  'DevTools': 3.5,
  'Infrastructure': 4.2,
  'Data Platform': 3.8,
  'Observability': 3.2,
  'API-First': 3.7,
  'FinTech': 2.8,
  'HealthTech': 3.0,
  'E-commerce': 4.5,
  'default': 3.5
};

export const PERCENTILE_THRESHOLDS: Record<string, number> = {
  '90th': 0.8,
  '75th': 1.5,
  '50th': 2.5,
  '25th': 3.8,
  '10th': 5.0
};

const calculatePercentile = (rate: number): number => {
  if (rate <= PERCENTILE_THRESHOLDS['90th']) return 90;
  if (rate <= PERCENTILE_THRESHOLDS['75th']) return 75;
  if (rate <= PERCENTILE_THRESHOLDS['50th']) return 50;
  if (rate <= PERCENTILE_THRESHOLDS['25th']) return 25;
  return 10;
};

export const calculateBenchmark = (
  totalLeakage: number,
  totalARR: number,
  vertical: string = 'default'
): BenchmarkData => {
  const yourLeakageRate = totalARR > 0 ? (totalLeakage / totalARR) * 100 : 0;
  const industryAverage = INDUSTRY_AVERAGES[vertical] || INDUSTRY_AVERAGES.default;
  const bestInClass = PERCENTILE_THRESHOLDS['90th'];
  
  const yourPercentile = calculatePercentile(yourLeakageRate);
  
  const to75thPercentile = Math.max(0, 
    ((yourLeakageRate - PERCENTILE_THRESHOLDS['75th']) / 100) * totalARR
  );
  
  const toBestInClass = Math.max(0,
    ((yourLeakageRate - bestInClass) / 100) * totalARR
  );
  
  return {
    yourLeakageRate: Math.round(yourLeakageRate * 10) / 10,
    industryAverage,
    bestInClass,
    yourPercentile,
    improvementOpportunity: {
      to75thPercentile: Math.round(to75thPercentile),
      toBestInClass: Math.round(toBestInClass)
    }
  };
};

export const getPercentileLabel = (percentile: number): string => {
  if (percentile >= 90) return 'Best-in-Class';
  if (percentile >= 75) return 'Above Average';
  if (percentile >= 50) return 'Average';
  if (percentile >= 25) return 'Below Average';
  return 'Needs Improvement';
};
