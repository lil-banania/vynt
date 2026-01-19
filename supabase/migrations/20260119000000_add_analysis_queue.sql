-- Create analysis queue table for processing large files in chunks
CREATE TABLE IF NOT EXISTS analysis_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'error')),
  chunk_index INTEGER NOT NULL DEFAULT 0,
  total_chunks INTEGER NOT NULL DEFAULT 1,
  file1_start_row INTEGER NOT NULL DEFAULT 0,
  file1_end_row INTEGER NOT NULL DEFAULT 0,
  file2_start_row INTEGER NOT NULL DEFAULT 0,
  file2_end_row INTEGER NOT NULL DEFAULT 0,
  anomalies_found INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Index for efficient queue processing
CREATE INDEX IF NOT EXISTS idx_analysis_queue_status ON analysis_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_analysis_queue_audit ON analysis_queue(audit_id);

-- Add is_chunked flag to audits
ALTER TABLE audits ADD COLUMN IF NOT EXISTS is_chunked BOOLEAN DEFAULT FALSE;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS chunks_completed INTEGER DEFAULT 0;
ALTER TABLE audits ADD COLUMN IF NOT EXISTS chunks_total INTEGER DEFAULT 0;
