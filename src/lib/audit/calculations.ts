import { Anomaly } from "@/lib/types/database";

// ============================================================================
// FINANCIAL IMPACT CALCULATIONS
// ============================================================================

export interface FinancialImpactData {
  totalRevenueAtRisk: number;
  estimatedRecoverable: number;
  vyntAnnualCost: number;
  netBenefitYear1: number;
  roi: number;
  paybackPeriodMonths: number;
}

export const getPricingTier = (totalARR: number): number => {
  if (totalARR < 10_000_000) return 36_000;      // $3K/mo
  if (totalARR < 50_000_000) return 60_000;      // $5K/mo
  if (totalARR < 100_000_000) return 120_000;    // $10K/mo
  return 180_000;                                 // $15K/mo
};

export const calculateFinancialImpact = (
  totalRevenueAtRisk: number,
  totalARR: number
): FinancialImpactData => {
  const estimatedRecoverable = totalRevenueAtRisk * 0.85;
  const vyntAnnualCost = getPricingTier(totalARR);
  const netBenefitYear1 = estimatedRecoverable - vyntAnnualCost;
  const roi = vyntAnnualCost > 0 ? netBenefitYear1 / vyntAnnualCost : 0;
  const paybackPeriodMonths = estimatedRecoverable > 0 
    ? (vyntAnnualCost / estimatedRecoverable) * 12 
    : 12;
  
  return {
    totalRevenueAtRisk,
    estimatedRecoverable,
    vyntAnnualCost,
    netBenefitYear1,
    roi,
    paybackPeriodMonths
  };
};

// ============================================================================
// CONFIDENCE SCORING
// ============================================================================

export interface ConfidenceFactors {
  dataCompleteness: number;
  customerStatus: number;
  clarityOfRootCause: number;
  recencyOfAnomaly: number;
}

export const calculateConfidenceScore = (anomaly: Partial<Anomaly> & {
  has_complete_data?: boolean;
  customer_active?: boolean;
  root_cause_identified?: boolean;
  days_since_detected?: number;
}): number => {
  const factors: ConfidenceFactors = {
    dataCompleteness: anomaly.has_complete_data !== false ? 100 : 60,
    customerStatus: anomaly.customer_active !== false ? 100 : 40,
    clarityOfRootCause: anomaly.root_cause_identified ? 90 : 50,
    recencyOfAnomaly: Math.max(0, 100 - ((anomaly.days_since_detected ?? 0) * 2))
  };
  
  // Weighted average
  const score = (
    factors.dataCompleteness * 0.30 +
    factors.customerStatus * 0.30 +
    factors.clarityOfRootCause * 0.25 +
    factors.recencyOfAnomaly * 0.15
  );
  
  return Math.round(score);
};

export const getConfidenceLabel = (score: number): 'high' | 'medium' | 'low' => {
  if (score >= 80) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
};

// ============================================================================
// LEAKAGE VELOCITY
// ============================================================================

export interface LeakageVelocity {
  monthlyLoss: number;
  projected12MonthLoss: number;
  timeSinceLastAudit: string;
  withoutAction: {
    q1: number;
    q2: number;
    fy: number;
  };
  urgency: 'immediate' | 'high' | 'medium';
}

export const calculateVelocity = (
  totalAnnualLeakage: number,
  lastAuditDate?: Date | null
): LeakageVelocity => {
  const monthlyLoss = totalAnnualLeakage / 12;
  
  const today = new Date();
  const currentMonth = today.getMonth(); // 0-11
  
  // Quarters: Q1 = Jan-Mar (0-2), Q2 = Apr-Jun (3-5), Q3 = Jul-Sep (6-8), Q4 = Oct-Dec (9-11)
  const currentQuarter = Math.floor(currentMonth / 3);
  
  const monthsLeftInQ1 = currentQuarter === 0 ? 3 - (currentMonth % 3) : 0;
  const monthsLeftInQ2 = currentQuarter <= 1 ? (6 - currentMonth) : 0;
  const monthsLeftInFY = 12 - currentMonth;
  
  const withoutAction = {
    q1: monthlyLoss * Math.max(monthsLeftInQ1, 0),
    q2: monthlyLoss * Math.max(monthsLeftInQ2, 0),
    fy: monthlyLoss * monthsLeftInFY
  };
  
  const timeSinceLastAudit = lastAuditDate
    ? `${Math.floor((today.getTime() - lastAuditDate.getTime()) / (1000 * 60 * 60 * 24 * 30))} months`
    : 'Never';
  
  const urgency = totalAnnualLeakage > 200000 ? 'immediate'
    : totalAnnualLeakage > 100000 ? 'high'
    : 'medium';
  
  return {
    monthlyLoss: Math.round(monthlyLoss),
    projected12MonthLoss: totalAnnualLeakage,
    timeSinceLastAudit,
    withoutAction: {
      q1: Math.round(withoutAction.q1),
      q2: Math.round(withoutAction.q2),
      fy: Math.round(withoutAction.fy)
    },
    urgency
  };
};

// ============================================================================
// CUSTOMER DISPLAY
// ============================================================================

const hashCode = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
};

export const formatCustomerDisplay = (
  customerId: string | null,
  customerName?: string | null,
  customerTier?: string | null
): string => {
  // If real customer name available
  if (customerName) {
    return `${customerName}${customerTier ? ` (${customerTier})` : ''}`;
  }
  
  if (!customerId) return 'Unknown Customer';
  
  // Otherwise use anonymous format
  const tierMap: Record<number, string> = {
    0: 'Enterprise',
    1: 'Mid-Market',
    2: 'Growth',
    3: 'SMB'
  };
  
  const hash = hashCode(customerId);
  const tier = customerTier || tierMap[hash % 4] || 'Standard';
  const letter = String.fromCharCode(65 + (hash % 26)); // A-Z
  
  return `Customer ${letter} (${tier})`;
};

// ============================================================================
// FORMAT UTILITIES
// ============================================================================

export const formatCurrency = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return "$0";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
};

export const formatPercentage = (value: number): string => {
  return `${Math.round(value * 10) / 10}%`;
};
