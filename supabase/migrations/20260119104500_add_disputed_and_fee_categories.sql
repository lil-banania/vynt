-- Extend anomaly categories to include disputed and fee discrepancy
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
    'disputed_charge',
    'fee_discrepancy',
    'other'
  )
);
