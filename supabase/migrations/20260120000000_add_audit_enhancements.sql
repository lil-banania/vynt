-- ============================================================================
-- AUDIT ENHANCEMENTS FOR CFO-READY REPORTS
-- ============================================================================

-- Anomalies table enhancements
-- Confidence scoring fields
ALTER TABLE anomalies ADD COLUMN IF NOT EXISTS confidence_score INTEGER DEFAULT 70;
ALTER TABLE anomalies ADD COLUMN IF NOT EXISTS has_complete_data BOOLEAN DEFAULT true;
ALTER TABLE anomalies ADD COLUMN IF NOT EXISTS customer_active BOOLEAN DEFAULT true;
ALTER TABLE anomalies ADD COLUMN IF NOT EXISTS root_cause_identified BOOLEAN DEFAULT false;
ALTER TABLE anomalies ADD COLUMN IF NOT EXISTS days_since_detected INTEGER DEFAULT 0;

-- Priority fields
ALTER TABLE anomalies ADD COLUMN IF NOT EXISTS priority_level TEXT DEFAULT 'medium';
ALTER TABLE anomalies ADD COLUMN IF NOT EXISTS estimated_fix_hours INTEGER DEFAULT 4;

-- Customer display
ALTER TABLE anomalies ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE anomalies ADD COLUMN IF NOT EXISTS customer_tier TEXT;

-- Technical details (JSONB for flexibility)
ALTER TABLE anomalies ADD COLUMN IF NOT EXISTS technical_details JSONB;
ALTER TABLE anomalies ADD COLUMN IF NOT EXISTS recommended_actions JSONB;

-- Audits table enhancements
-- Benchmark data
ALTER TABLE audits ADD COLUMN IF NOT EXISTS total_arr DECIMAL(15,2);
ALTER TABLE audits ADD COLUMN IF NOT EXISTS company_vertical TEXT DEFAULT 'DevTools';
ALTER TABLE audits ADD COLUMN IF NOT EXISTS leakage_rate DECIMAL(5,2);

-- Velocity tracking
ALTER TABLE audits ADD COLUMN IF NOT EXISTS previous_audit_date TIMESTAMP;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS monthly_loss DECIMAL(15,2);

-- Add check constraint for priority_level
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'anomalies_priority_level_check'
  ) THEN
    ALTER TABLE anomalies ADD CONSTRAINT anomalies_priority_level_check
    CHECK (priority_level IN ('high', 'medium', 'low'));
  END IF;
END $$;

-- Add check constraint for customer_tier
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'anomalies_customer_tier_check'
  ) THEN
    ALTER TABLE anomalies ADD CONSTRAINT anomalies_customer_tier_check
    CHECK (customer_tier IN ('Enterprise', 'Mid-Market', 'Growth', 'SMB', 'Starter'));
  END IF;
END $$;
