import { Anomaly, AnomalyCategory } from "@/lib/types/database";

// ============================================================================
// ENHANCED ROOT CAUSE
// ============================================================================

export interface EnhancedRootCause {
  description: string;
  confidence: number;
  technicalDetails?: Record<string, string>;
  recommendedFix: string[];
  estimatedFixTime: string;
  recoveryPotential: number;
}

export const getRootCauseTemplate = (anomaly: Anomaly): EnhancedRootCause => {
  const templates: Partial<Record<AnomalyCategory, EnhancedRootCause>> = {
    unbilled_usage: {
      description: 'Failed webhook delivery to billing system',
      confidence: 87,
      technicalDetails: {
        'Event Type': 'usage.recorded',
        'Detection Method': 'Cross-reference DB vs Stripe',
        'Affected Period': 'Last 30 days',
        'Retry Status': 'Webhook delivery failed'
      },
      recommendedFix: [
        'Investigate webhook endpoint latency',
        'Implement async processing for webhook handling',
        'Add retry queue with exponential backoff'
      ],
      estimatedFixTime: '2-4 hours',
      recoveryPotential: anomaly.annual_impact ?? 0
    },
    
    pricing_mismatch: {
      description: 'Customer tier not synced between systems',
      confidence: 92,
      technicalDetails: {
        'Discrepancy Type': 'Pricing tier mismatch',
        'Detection Method': 'Amount comparison',
        'Systems Affected': 'DB ↔ Stripe'
      },
      recommendedFix: [
        'Update customer to correct pricing tier in Stripe',
        'Issue credit for any overcharges',
        'Implement automated tier validation on plan changes'
      ],
      estimatedFixTime: '1 hour',
      recoveryPotential: anomaly.annual_impact ?? 0
    },
    
    duplicate_charge: {
      description: 'Multiple identical charges detected - possible idempotency issue',
      confidence: 78,
      technicalDetails: {
        'Pattern': 'Multiple charges same customer/amount/date',
        'Likely Cause': 'Missing idempotency key or race condition',
        'Impact': 'Customer overcharged'
      },
      recommendedFix: [
        'Implement idempotency keys in payment flow',
        'Add frontend button debouncing (300ms)',
        'Review payment processing for race conditions'
      ],
      estimatedFixTime: '3-6 hours',
      recoveryPotential: anomaly.annual_impact ?? 0
    },
    
    zombie_subscription: {
      description: 'Active subscription with zero product usage',
      confidence: 95,
      technicalDetails: {
        'Subscription Status': 'Active (auto-renewing)',
        'Usage Status': 'No recent activity detected',
        'Detection Method': 'Stripe charge without DB transaction match'
      },
      recommendedFix: [
        'Contact customer to verify subscription intent',
        'Offer usage consultation or cancellation',
        'Implement automated inactive subscription alerts'
      ],
      estimatedFixTime: '1-2 hours',
      recoveryPotential: anomaly.annual_impact ?? 0
    },

    failed_payment: {
      description: 'Payment recorded as failed in DB but not reflected in Stripe',
      confidence: 85,
      technicalDetails: {
        'Payment Status': 'Failed in DB',
        'Stripe Status': 'No matching record',
        'Detection Method': 'Status cross-reference'
      },
      recommendedFix: [
        'Review payment failure reason codes',
        'Implement dunning workflow for retry',
        'Add payment method update notifications'
      ],
      estimatedFixTime: '2-4 hours',
      recoveryPotential: anomaly.annual_impact ?? 0
    },

    disputed_charge: {
      description: 'Charge disputed in DB but Stripe shows succeeded without dispute',
      confidence: 90,
      technicalDetails: {
        'DB Status': 'disputed',
        'Stripe Status': 'succeeded',
        'Dispute Flag': 'FALSE in Stripe',
        'Sync Issue': 'Status not propagated'
      },
      recommendedFix: [
        'Reconcile dispute status between systems',
        'Implement webhook for dispute.created event',
        'Add monitoring for status mismatches'
      ],
      estimatedFixTime: '2-3 hours',
      recoveryPotential: anomaly.annual_impact ?? 0
    },

    fee_discrepancy: {
      description: 'Processing fee amounts differ between DB and Stripe records',
      confidence: 75,
      technicalDetails: {
        'Discrepancy Type': 'Fee amount mismatch',
        'Expected': 'Stripe fee (2.9% + $0.30)',
        'Detection Threshold': '> $1.00 difference'
      },
      recommendedFix: [
        'Sync fee recording with actual Stripe fees',
        'Use Stripe webhook to capture actual fee',
        'Review fee calculation logic'
      ],
      estimatedFixTime: '1-2 hours',
      recoveryPotential: anomaly.annual_impact ?? 0
    }
  };
  
  return templates[anomaly.category] ?? getDefaultRootCause(anomaly);
};

const getDefaultRootCause = (anomaly: Anomaly): EnhancedRootCause => {
  return {
    description: 'Billing discrepancy detected - investigation required',
    confidence: 65,
    technicalDetails: {
      'Category': anomaly.category,
      'Detection Date': new Date().toISOString().split('T')[0]
    },
    recommendedFix: [
      'Review billing and usage data for this customer',
      'Determine specific root cause',
      'Implement appropriate fix'
    ],
    estimatedFixTime: '2-4 hours',
    recoveryPotential: anomaly.annual_impact ?? 0
  };
};
