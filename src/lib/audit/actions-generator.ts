import { Anomaly, AnomalyCategory } from "@/lib/types/database";
import { formatCustomerDisplay } from "./calculations";

// ============================================================================
// ACTION GENERATION
// ============================================================================

export interface ActionItem {
  task: string;
  completed: boolean;
}

export interface RecommendedActions {
  immediate: ActionItem[];
  shortTerm: ActionItem[];
  longTerm: ActionItem[];
  owner: string[];
  timeline: string;
  estimatedEffort: number;
  annualImpact: number;
}

const formatCustomer = (anomaly: Anomaly): string => {
  return formatCustomerDisplay(
    anomaly.customer_id,
    (anomaly as Record<string, unknown>).customer_name as string | undefined,
    (anomaly as Record<string, unknown>).customer_tier as string | undefined
  );
};

export const generateActions = (anomaly: Anomaly): RecommendedActions => {
  const templates: Partial<Record<AnomalyCategory, RecommendedActions>> = {
    unbilled_usage: {
      immediate: [
        { task: `Contact ${formatCustomer(anomaly)} to verify usage vs billing`, completed: false },
        { task: 'Review usage logs for missing billing events', completed: false },
        { task: 'Check Stripe webhook delivery status', completed: false }
      ],
      shortTerm: [
        { task: 'Implement webhook retry mechanism', completed: false },
        { task: 'Add monitoring for webhook failures', completed: false },
        { task: 'Backfill missing invoices', completed: false }
      ],
      longTerm: [
        { task: 'Migrate to event-driven billing architecture', completed: false },
        { task: 'Add real-time usage reconciliation', completed: false },
        { task: 'Implement automated alerts for missing events', completed: false }
      ],
      owner: ['Engineering', 'Finance'],
      timeline: '2 weeks',
      estimatedEffort: 16,
      annualImpact: anomaly.annual_impact ?? 0
    },
    
    pricing_mismatch: {
      immediate: [
        { task: 'Review customer contract and current pricing tier', completed: false },
        { task: 'Verify expected vs actual pricing in Stripe', completed: false }
      ],
      shortTerm: [
        { task: 'Update customer to correct pricing tier', completed: false },
        { task: 'Issue credit/refund for overcharges', completed: false },
        { task: 'Implement pricing validation on tier changes', completed: false }
      ],
      longTerm: [
        { task: 'Add automated pricing tier validation', completed: false },
        { task: 'Create workflow for pricing change approvals', completed: false }
      ],
      owner: ['Finance'],
      timeline: '1 week',
      estimatedEffort: 8,
      annualImpact: anomaly.annual_impact ?? 0
    },
    
    duplicate_charge: {
      immediate: [
        { task: 'Refund duplicate charge immediately', completed: false },
        { task: `Contact ${formatCustomer(anomaly)} to explain and apologize`, completed: false }
      ],
      shortTerm: [
        { task: 'Implement idempotency keys in payment flow', completed: false },
        { task: 'Add frontend debouncing on payment buttons', completed: false },
        { task: 'Review payment processing logic for race conditions', completed: false }
      ],
      longTerm: [
        { task: 'Add duplicate charge detection system', completed: false },
        { task: 'Implement automated refund workflows', completed: false }
      ],
      owner: ['Engineering'],
      timeline: '1 week',
      estimatedEffort: 6,
      annualImpact: anomaly.annual_impact ?? 0
    },
    
    zombie_subscription: {
      immediate: [
        { task: `Verify ${formatCustomer(anomaly)} subscription status`, completed: false },
        { task: 'Check last login and product usage', completed: false }
      ],
      shortTerm: [
        { task: 'Cancel subscription if truly inactive', completed: false },
        { task: 'Contact customer for reactivation opportunity', completed: false },
        { task: 'Implement usage-based auto-cancellation policy', completed: false }
      ],
      longTerm: [
        { task: 'Add automated inactive subscription detection', completed: false },
        { task: 'Create customer engagement campaigns', completed: false }
      ],
      owner: ['Finance', 'Customer Success'],
      timeline: '1 week',
      estimatedEffort: 4,
      annualImpact: anomaly.annual_impact ?? 0
    },

    failed_payment: {
      immediate: [
        { task: `Review ${formatCustomer(anomaly)} payment failure reason`, completed: false },
        { task: 'Check if card on file is expired or declined', completed: false }
      ],
      shortTerm: [
        { task: 'Implement dunning email sequence', completed: false },
        { task: 'Add payment method update reminder', completed: false },
        { task: 'Set up automatic retry logic', completed: false }
      ],
      longTerm: [
        { task: 'Implement smart retry timing based on failure reason', completed: false },
        { task: 'Add multiple payment method fallback', completed: false }
      ],
      owner: ['Engineering', 'Finance'],
      timeline: '1-2 weeks',
      estimatedEffort: 12,
      annualImpact: anomaly.annual_impact ?? 0
    },

    disputed_charge: {
      immediate: [
        { task: 'Gather evidence for dispute response', completed: false },
        { task: `Review ${formatCustomer(anomaly)} communication history`, completed: false }
      ],
      shortTerm: [
        { task: 'Submit dispute evidence to Stripe', completed: false },
        { task: 'Contact customer to resolve directly if possible', completed: false },
        { task: 'Review product/service delivery for this customer', completed: false }
      ],
      longTerm: [
        { task: 'Improve terms of service visibility', completed: false },
        { task: 'Add pre-charge confirmation for large amounts', completed: false }
      ],
      owner: ['Finance', 'Customer Success'],
      timeline: '1-2 weeks',
      estimatedEffort: 8,
      annualImpact: anomaly.annual_impact ?? 0
    },

    fee_discrepancy: {
      immediate: [
        { task: 'Compare fee calculation logic between DB and Stripe', completed: false },
        { task: 'Verify Stripe fee configuration', completed: false }
      ],
      shortTerm: [
        { task: 'Sync fee recording logic with actual Stripe fees', completed: false },
        { task: 'Add fee validation in reconciliation process', completed: false }
      ],
      longTerm: [
        { task: 'Implement real-time fee tracking from Stripe webhooks', completed: false },
        { task: 'Add automated fee reconciliation alerts', completed: false }
      ],
      owner: ['Engineering'],
      timeline: '1 week',
      estimatedEffort: 4,
      annualImpact: anomaly.annual_impact ?? 0
    }
  };
  
  return templates[anomaly.category] ?? getDefaultActions(anomaly);
};

const getDefaultActions = (anomaly: Anomaly): RecommendedActions => {
  return {
    immediate: [
      { task: `Investigate anomaly for ${formatCustomer(anomaly)}`, completed: false }
    ],
    shortTerm: [
      { task: 'Determine root cause and fix', completed: false }
    ],
    longTerm: [
      { task: 'Implement preventive measures', completed: false }
    ],
    owner: ['Finance'],
    timeline: '1-2 weeks',
    estimatedEffort: 4,
    annualImpact: anomaly.annual_impact ?? 0
  };
};
