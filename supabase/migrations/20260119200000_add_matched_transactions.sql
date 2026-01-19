-- Table to track matched transactions across chunks
-- This preserves matching state between chunk processing calls

-- Ensure UUID extension is available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS matched_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  db_transaction_id TEXT,
  stripe_id TEXT,
  match_type TEXT, -- 'customer_amount', 'amount_date', etc.
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups during chunk processing
CREATE INDEX IF NOT EXISTS idx_matched_transactions_audit_stripe 
  ON matched_transactions(audit_id, stripe_id);

CREATE INDEX IF NOT EXISTS idx_matched_transactions_audit_db 
  ON matched_transactions(audit_id, db_transaction_id);

-- Cleanup trigger: delete matched_transactions when audit is deleted
-- (already handled by CASCADE)
