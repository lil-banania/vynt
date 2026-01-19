-- Add new anomaly categories to the check constraint
-- First drop the old constraint, then add a new one with more categories

ALTER TABLE anomalies DROP CONSTRAINT IF EXISTS anomalies_category_check;

ALTER TABLE anomalies ADD CONSTRAINT anomalies_category_check CHECK (
  category IN (
    'zombie_subscription',
    'unbilled_usage', 
    'pricing_mismatch',
    'duplicate_charge',
    'failed_payment',
    'high_refund_rate',
    'missing_in_stripe',
    'missing_in_db',
    'amount_mismatch',
    'revenue_leakage',
    'other'
  )
);

-- Also update the status check to include 'open'
ALTER TABLE anomalies DROP CONSTRAINT IF EXISTS anomalies_status_check;

ALTER TABLE anomalies ADD CONSTRAINT anomalies_status_check CHECK (
  status IN ('detected', 'verified', 'resolved', 'dismissed', 'open')
);
