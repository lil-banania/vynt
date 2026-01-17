export type AuditStatus =
  | "draft"
  | "pending"
  | "processing"
  | "review"
  | "in_progress"
  | "completed"
  | "published";
export type AnomalyStatus = "detected" | "verified" | "resolved" | "dismissed";
// Database CHECK constraint only allows these 4 categories
export type AnomalyCategory =
  | "zombie_subscription"
  | "unbilled_usage"
  | "pricing_mismatch"
  | "duplicate_charge";
export type AnomalyConfidence = "low" | "medium" | "high";
export type UserRole =
  | "owner"
  | "admin"
  | "member"
  | "viewer"
  | "vynt_admin";
export type FileType =
  | "usage_logs"
  | "stripe_export"
  | "ledger"
  | "invoices"
  | "payments"
  | "customers"
  | "other";

export type Organization = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type Profile = {
  id: string;
  organization_id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  created_at: string;
};

export type Audit = {
  id: string;
  organization_id: string;
  status: AuditStatus;
  audit_period_start: string;
  audit_period_end: string;
  total_anomalies: number;
  annual_revenue_at_risk: number | null;
  created_at: string;
  published_at: string | null;
  created_by: string;
};

export type UploadedFile = {
  id: string;
  audit_id: string;
  file_type: FileType;
  file_name: string;
  file_path: string;
  row_count: number | null;
  uploaded_at: string;
};

export type Anomaly = {
  id: string;
  audit_id: string;
  category: AnomalyCategory;
  customer_id: string | null;
  status: AnomalyStatus;
  confidence: AnomalyConfidence;
  annual_impact: number | null;
  monthly_impact: number | null;
  description: string | null;
  root_cause: string | null;
  recommendation: string | null;
  metadata: Record<string, unknown> | null;
  detected_at: string;
};