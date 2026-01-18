import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import Papa from "papaparse";

import { createClient as createServerClient } from "@/lib/supabase/server";

// ============================================================================
// COLUMN MAPPING - Flexible auto-detection for various CSV formats
// ============================================================================

// For internal DB/transaction logs
const DB_COLUMN_HINTS: Record<string, string[]> = {
  transaction_id: ["transaction_id", "txn_id", "id", "internal_id", "record_id", "event_id"],
  customer_id: ["customer_id", "customer", "cust_id", "user_id", "account_id", "client_id"],
  amount: ["amount", "gross_amount", "total", "charge_amount", "price", "value"],
  net_amount: ["net_amount", "net", "amount_net"],
  fee_amount: ["fee_amount", "fee", "fees", "stripe_fee", "processing_fee"],
  status: ["status", "state", "payment_status", "transaction_status"],
  created_at: ["created_at", "created", "timestamp", "date", "transaction_date"],
  updated_at: ["updated_at", "updated", "modified_at"],
  description: ["description", "memo", "note", "product", "plan", "plan_name"],
  invoice_id: ["invoice_id", "invoice", "inv_id"],
  subscription_id: ["subscription_id", "subscription", "sub_id"],
  customer_email: ["customer_email", "email", "user_email"],
  customer_name: ["customer_name", "name", "full_name"],
  currency: ["currency", "curr"],
};

// For Stripe export
const STRIPE_COLUMN_HINTS: Record<string, string[]> = {
  id: ["id", "charge_id", "payment_id", "transaction_id", "stripe_id"],
  customer: ["customer", "customer_id", "cust_id", "stripe_customer_id"],
  amount: ["amount", "total", "charge_amount", "price", "gross"],
  fee: ["fee", "stripe_fee", "processing_fee", "application_fee", "application_fee_amount"],
  net: ["net", "net_amount", "amount_net"],
  status: ["status", "state", "payment_status", "charge_status", "outcome"],
  created: ["created", "date", "timestamp", "created_at", "payment_date"],
  currency: ["currency", "curr"],
  description: ["description", "memo", "note", "product", "plan"],
  customer_email: ["customer_email", "email", "receipt_email"],
  customer_name: ["customer_name", "name", "customer_description"],
  amount_refunded: ["amount_refunded", "refunded", "refund_amount"],
  disputed: ["disputed", "dispute", "is_disputed"],
  object: ["object", "type", "record_type"],
  payout_id: ["payout_id", "payout", "transfer_id", "destination"],
  balance_transaction: ["balance_transaction", "balance_txn", "txn"],
  payment_intent: ["payment_intent", "pi_id"],
};

// For usage/product logs (backward compatibility)
const USAGE_COLUMN_HINTS: Record<string, string[]> = {
  customer_id: ["customer_id", "customer", "cust_id", "user_id", "account_id"],
  timestamp: ["timestamp", "date", "created_at", "event_date", "time", "created"],
  quantity: ["quantity", "amount", "count", "units", "value", "usage", "qty"],
  event_type: ["event_type", "type", "event", "action", "category", "plan"],
  event_id: ["event_id", "id", "uuid", "transaction_id", "record_id"],
};

type AnomalyInsert = {
  audit_id: string;
  category: string;
  customer_id: string | null;
  status: string;
  confidence: string;
  annual_impact: number | null;
  monthly_impact: number | null;
  description: string;
  root_cause: string;
  recommendation: string;
  detected_at: string;
  metadata: Record<string, unknown> | null;
};

function findColumn(headers: string[], hints: string[]): string | null {
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());
  for (const hint of hints) {
    const idx = lowerHeaders.findIndex((h) => h === hint.toLowerCase() || h.includes(hint.toLowerCase()));
    if (idx !== -1) return headers[idx];
  }
  return null;
}

function mapRow(row: Record<string, string>, mapping: Record<string, string | null>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, col] of Object.entries(mapping)) {
    if (col && row[col] !== undefined) {
      result[key] = row[col];
    }
  }
  return result;
}

function parseAmount(value: string | undefined): number {
  if (!value) return 0;
  const cleaned = value.replace(/[^0-9.-]/g, "");
  return Number(cleaned) || 0;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  // Handle Unix timestamp (seconds)
  const num = Number(value);
  if (!isNaN(num) && num > 1000000000) {
    return new Date(num * 1000);
  }
  // Handle ISO date string
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

const DEFAULT_CURRENCY = "EUR";

function formatCurrency(cents: number, currencyCode: string = DEFAULT_CURRENCY): string {
  const normalized = (currencyCode || DEFAULT_CURRENCY).toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalized,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `€${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

type ReconciliationConfig = {
  payoutGraceDays: number;
  unreconciledRiskPct: number;
  feeDiscrepancyThresholdCents: number;
  timingMismatchDays: number;
  payoutGroupMinTransactions: number;
  grossDiffThresholdCents: number;
  annualizationMonths: number;
  chargebackFeeAmount: number;
  currencyCode?: string;
};

const DEFAULT_CONFIG: ReconciliationConfig = {
  payoutGraceDays: 4,
  unreconciledRiskPct: 0.05,
  feeDiscrepancyThresholdCents: 100,
  timingMismatchDays: 1,
  payoutGroupMinTransactions: 3,
  grossDiffThresholdCents: 100,
  annualizationMonths: 12,
  chargebackFeeAmount: 15,
  currencyCode: undefined,
};

function resolveConfig(input: Partial<ReconciliationConfig> | null | undefined): ReconciliationConfig {
  return {
    payoutGraceDays: Number.isFinite(input?.payoutGraceDays) ? Math.max(0, Number(input?.payoutGraceDays)) : DEFAULT_CONFIG.payoutGraceDays,
    unreconciledRiskPct: Number.isFinite(input?.unreconciledRiskPct) ? Math.max(0, Number(input?.unreconciledRiskPct)) : DEFAULT_CONFIG.unreconciledRiskPct,
    feeDiscrepancyThresholdCents: Number.isFinite(input?.feeDiscrepancyThresholdCents)
      ? Math.max(0, Number(input?.feeDiscrepancyThresholdCents))
      : DEFAULT_CONFIG.feeDiscrepancyThresholdCents,
    timingMismatchDays: Number.isFinite(input?.timingMismatchDays) ? Math.max(0, Number(input?.timingMismatchDays)) : DEFAULT_CONFIG.timingMismatchDays,
    payoutGroupMinTransactions: Number.isFinite(input?.payoutGroupMinTransactions)
      ? Math.max(1, Number(input?.payoutGroupMinTransactions))
      : DEFAULT_CONFIG.payoutGroupMinTransactions,
    grossDiffThresholdCents: Number.isFinite(input?.grossDiffThresholdCents)
      ? Math.max(0, Number(input?.grossDiffThresholdCents))
      : DEFAULT_CONFIG.grossDiffThresholdCents,
    annualizationMonths: Number.isFinite(input?.annualizationMonths)
      ? Math.max(1, Number(input?.annualizationMonths))
      : DEFAULT_CONFIG.annualizationMonths,
    chargebackFeeAmount: Number.isFinite(input?.chargebackFeeAmount)
      ? Math.max(0, Number(input?.chargebackFeeAmount))
      : DEFAULT_CONFIG.chargebackFeeAmount,
    currencyCode: typeof input?.currencyCode === "string" && input.currencyCode.trim() ? input.currencyCode.trim().toUpperCase() : undefined,
  };
}

// ============================================================================
// RECONCILIATION ENGINE
// ============================================================================

export async function POST(request: Request) {
  const serverSupabase = await createServerClient();
  const {
    data: { user },
    error: userError,
  } = await serverSupabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const auditId = body?.auditId;

  if (!auditId || typeof auditId !== "string") {
    return NextResponse.json({ error: "Audit ID is required." }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Server configuration missing." }, { status: 500 });
  }

  const adminSupabase = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: auditMeta, error: auditMetaError } = await adminSupabase
    .from("audits")
    .select("id, organization_id")
    .eq("id", auditId)
    .maybeSingle();

  if (auditMetaError || !auditMeta) {
    return NextResponse.json({ error: "Audit not found." }, { status: 404 });
  }

  const { data: organization } = await adminSupabase
    .from("organizations")
    .select("*")
    .eq("id", auditMeta.organization_id)
    .maybeSingle();

  const orgConfigRaw =
    organization && typeof organization.reconciliation_config === "object"
      ? (organization.reconciliation_config as Record<string, unknown>)
      : {};
  const orgConfigSettings =
    typeof orgConfigRaw.settings === "object" && orgConfigRaw.settings
      ? (orgConfigRaw.settings as Record<string, unknown>)
      : orgConfigRaw;

  const config = resolveConfig({
    ...(orgConfigSettings as Partial<ReconciliationConfig>),
    ...(body?.config as Partial<ReconciliationConfig> | undefined),
  });

  // Get uploaded files
  const { data: files } = await adminSupabase
    .from("uploaded_files")
    .select("id, file_type, file_path")
    .eq("audit_id", auditId);

  if (!files || files.length < 2) {
    return NextResponse.json({ error: "Both files are required." }, { status: 400 });
  }

  const file1 = files.find((f) => f.file_type === "usage_logs");
  const file2 = files.find((f) => f.file_type === "stripe_export");

  if (!file1 || !file2) {
    return NextResponse.json({ error: "Both files are required." }, { status: 400 });
  }

  // Download CSVs
  const { data: file1Data } = await adminSupabase.storage.from("audit-files").download(file1.file_path);
  const { data: file2Data } = await adminSupabase.storage.from("audit-files").download(file2.file_path);

  if (!file1Data || !file2Data) {
    return NextResponse.json({ error: "Failed to download files." }, { status: 500 });
  }

  const file1Text = await file1Data.text();
  const file2Text = await file2Data.text();

  const file1Result = Papa.parse<Record<string, string>>(file1Text, { header: true, skipEmptyLines: true });
  const file2Result = Papa.parse<Record<string, string>>(file2Text, { header: true, skipEmptyLines: true });

  if (file1Result.errors.length > 0 || file2Result.errors.length > 0) {
    return NextResponse.json(
      {
        error: "Failed to parse CSV files.",
        details: [
          ...file1Result.errors.map((err) => `usage_logs: ${err.message}`),
          ...file2Result.errors.map((err) => `stripe_export: ${err.message}`),
        ].join(" | "),
      },
      { status: 400 }
    );
  }

  const file1Headers = file1Result.meta.fields ?? [];
  const file2Headers = file2Result.meta.fields ?? [];

  if (file1Headers.length === 0 || file2Headers.length === 0) {
    return NextResponse.json({ error: "CSV headers are missing." }, { status: 400 });
  }

  const file1Rows = file1Result.data.filter(
    (row): row is Record<string, string> => Boolean(row) && typeof row === "object"
  );
  const file2Rows = file2Result.data.filter(
    (row): row is Record<string, string> => Boolean(row) && typeof row === "object"
  );

  if (file1Rows.length === 0 || file2Rows.length === 0) {
    return NextResponse.json({ error: "CSV files do not contain any valid rows." }, { status: 400 });
  }

  // Detect file type based on columns
  const isDbTransactionLog = findColumn(file1Headers, ["transaction_id", "txn_id", "net_amount", "fee_amount"]) !== null;
  
  const anomalies: AnomalyInsert[] = [];
  const now = new Date().toISOString();

  if (isDbTransactionLog) {
    // ========================================================================
    // MODE: DB Transaction Logs vs Stripe Export (Full Reconciliation)
    // ========================================================================
    
    // Map DB columns
    const dbMapping: Record<string, string | null> = {};
    for (const [key, hints] of Object.entries(DB_COLUMN_HINTS)) {
      dbMapping[key] = findColumn(file1Headers, hints);
    }

    // Map Stripe columns
    const stripeMapping: Record<string, string | null> = {};
    for (const [key, hints] of Object.entries(STRIPE_COLUMN_HINTS)) {
      stripeMapping[key] = findColumn(file2Headers, hints);
    }

    const dbRows = file1Rows.map((row) => mapRow(row, dbMapping));
    const stripeRows = file2Rows.map((row) => mapRow(row, stripeMapping));
    const currencyCode =
      config.currencyCode ||
      stripeRows.find((row) => row.currency)?.currency?.toUpperCase() ||
      dbRows.find((row) => row.currency)?.currency?.toUpperCase() ||
      DEFAULT_CURRENCY;

    // Build lookup maps
    const stripeById = new Map<string, typeof stripeRows[0]>();
    const stripeByCustomerAmount = new Map<string, typeof stripeRows[0][]>();
    
    for (const row of stripeRows) {
      if (row.id) stripeById.set(row.id, row);
      
      const key = `${row.customer}_${parseAmount(row.amount)}`;
      if (!stripeByCustomerAmount.has(key)) stripeByCustomerAmount.set(key, []);
      stripeByCustomerAmount.get(key)!.push(row);
    }

    const dbByCustomerAmount = new Map<string, typeof dbRows[0][]>();
    for (const row of dbRows) {
      const key = `${row.customer_id}_${parseAmount(row.amount)}`;
      if (!dbByCustomerAmount.has(key)) dbByCustomerAmount.set(key, []);
      dbByCustomerAmount.get(key)!.push(row);
    }

    // Track which Stripe rows have been matched
    const matchedStripeIds = new Set<string>();

    // ========================================================================
    // ANOMALY 1: Transactions in DB but missing from Stripe
    // ========================================================================
    for (const dbRow of dbRows) {
      const status = dbRow.status?.toLowerCase();
      if (status === "failed") {
        // Check if failed transaction is missing from Stripe
        const stripeMatch = stripeRows.find(
          (s) =>
            s.customer === dbRow.customer_id &&
            parseAmount(s.amount) === parseAmount(dbRow.amount)
        );

        if (!stripeMatch) {
          const amount = parseAmount(dbRow.amount);
          anomalies.push({
            audit_id: auditId,
            category: "failed_payment",
            customer_id: dbRow.customer_id || null,
            status: "detected",
            confidence: "high",
            annual_impact: (amount / 100) * config.annualizationMonths,
            monthly_impact: amount / 100,
            description: `Failed payment for ${dbRow.customer_name || dbRow.customer_id} (${formatCurrency(amount, currencyCode)}) is recorded in DB but completely absent from Stripe export.`,
            root_cause: "Failed payments may not sync to Stripe export, or the payment attempt was not recorded in Stripe.",
            recommendation: "Review payment gateway logs. Ensure failed payment attempts are properly tracked for dunning sequences.",
            detected_at: now,
            metadata: {
              db_transaction_id: dbRow.transaction_id,
              amount,
              customer: dbRow.customer_email,
              invoice_id: dbRow.invoice_id,
              detection_method: "db_failed_without_stripe_match",
              confidence_reason: "No Stripe charge found with same customer and amount.",
              impact_type: "potential",
            },
          });
        }
      }

      if (status === "succeeded") {
        const amount = parseAmount(dbRow.amount);
        if (amount <= 0) continue;
        const key = `${dbRow.customer_id}_${amount}`;
        const candidates = stripeByCustomerAmount.get(key) ?? [];
        const stripeMatch = candidates.find(
          (row) =>
            row.object !== "refund" &&
            row.status?.toLowerCase() === "succeeded" &&
            (!row.id || !matchedStripeIds.has(row.id))
        );
        if (stripeMatch?.id) {
          matchedStripeIds.add(stripeMatch.id);
        } else {
          anomalies.push({
            audit_id: auditId,
            category: "pricing_mismatch",
            customer_id: dbRow.customer_id || null,
            status: "detected",
            confidence: "high",
            annual_impact: amount / 100,
            monthly_impact: amount / 100,
            description: `Charge for ${dbRow.customer_name || dbRow.customer_id} (${formatCurrency(amount, currencyCode)}) exists in DB but is missing from Stripe export.`,
            root_cause: "Missing charge in Stripe export, data sync lag, or charge captured outside of Stripe.",
            recommendation: "Verify charge in Stripe dashboard and ingestion pipeline. Backfill missing export entries.",
            detected_at: now,
            metadata: {
              db_transaction_id: dbRow.transaction_id,
              amount,
              invoice_id: dbRow.invoice_id,
              detection_method: "db_succeeded_without_stripe_match",
              confidence_reason: "No Stripe succeeded charge found with same customer and amount.",
              impact_type: "probable",
            },
          });
        }
      }
    }

    // ========================================================================
    // ANOMALY 2: Duplicate transactions in Stripe
    // ========================================================================
    const seenStripeCharges = new Map<string, typeof stripeRows[0][]>();
    
    for (const row of stripeRows) {
      if (row.object === "refund") continue; // Skip refunds for duplicate check
      
      const key = `${row.customer}_${row.amount}_${parseDate(row.created)?.toISOString().split("T")[0]}`;
      if (!seenStripeCharges.has(key)) seenStripeCharges.set(key, []);
      seenStripeCharges.get(key)!.push(row);
    }

    for (const [key, charges] of seenStripeCharges) {
      if (charges.length >= 2) {
        const amount = parseAmount(charges[0].amount);
        const customer = charges[0].customer;
        const ids = charges.map(c => c.id).join(", ");
        
        anomalies.push({
          audit_id: auditId,
          category: "duplicate_charge",
          customer_id: customer || null,
          status: "detected",
          confidence: "high",
          annual_impact: amount / 100, // Single occurrence, not annualized
          monthly_impact: amount / 100,
          description: `Customer ${customer} has ${charges.length} identical charges of ${formatCurrency(amount, currencyCode)} on the same date. Charge IDs: ${ids}`,
          root_cause: "Double-click on payment button, webhook retry issue, or manual billing error.",
          recommendation: `Implement idempotency keys. Review and refund confirmed duplicates (${formatCurrency(amount, currencyCode)} at risk).`,
          detected_at: now,
          metadata: {
            charge_ids: charges.map((c) => c.id),
            amount,
            count: charges.length,
            detection_method: "stripe_duplicate_same_customer_amount_date",
            confidence_reason: "Multiple Stripe charges with identical customer, amount, and date.",
            impact_type: "probable",
          },
        });
      }
    }

    // ========================================================================
    // ANOMALY 3: Disputed transactions with status inconsistency
    // ========================================================================
    for (const dbRow of dbRows) {
      if (dbRow.status?.toLowerCase() === "disputed") {
        const stripeMatch = stripeRows.find(s => 
          s.customer === dbRow.customer_id && 
          Math.abs(parseAmount(s.amount) - Math.abs(parseAmount(dbRow.amount))) < 100
        );
        
        if (stripeMatch && stripeMatch.status?.toLowerCase() === "succeeded") {
          const amount = Math.abs(parseAmount(dbRow.amount));
          if (stripeMatch.id) matchedStripeIds.add(stripeMatch.id);
          anomalies.push({
            audit_id: auditId,
            category: "dispute_chargeback",
            customer_id: dbRow.customer_id || null,
            status: "detected",
            confidence: "high",
            annual_impact: amount / 100 + config.chargebackFeeAmount,
            monthly_impact: amount / 100,
            description: `Dispute for ${dbRow.customer_name || dbRow.customer_id}: DB shows "disputed" status but Stripe still shows "succeeded". Amount: ${formatCurrency(amount, currencyCode)}`,
            root_cause: "Status sync delay between Stripe and internal DB, or dispute opened but not yet reflected in charge status.",
            recommendation: "Verify dispute status in Stripe dashboard. Update internal records. Prepare dispute evidence if needed.",
            detected_at: now,
            metadata: { 
              db_status: dbRow.status, 
              stripe_status: stripeMatch.status, 
              stripe_disputed: stripeMatch.disputed,
              amount,
              detection_method: "db_disputed_vs_stripe_succeeded",
              confidence_reason: "DB dispute with Stripe succeeded charge match.",
              impact_type: "probable",
            },
          });
        }
      }
    }

    // ========================================================================
    // ANOMALY 3B: Stripe charges missing from DB
    // ========================================================================
    const stripeSucceededCharges = stripeRows.filter(
      (row) => row.object !== "refund" && row.status?.toLowerCase() === "succeeded"
    );
    const unmatchedStripeCharges = stripeSucceededCharges.filter((row) => {
      const amount = parseAmount(row.amount);
      const key = `${row.customer}_${amount}`;
      if (row.id && matchedStripeIds.has(row.id)) return false;
      if (dbByCustomerAmount.has(key)) return false;
      return true;
    });

    if (unmatchedStripeCharges.length > 0) {
      const totalUnmatched = unmatchedStripeCharges.reduce(
        (sum, row) => sum + parseAmount(row.amount),
        0
      );
      const customers = [...new Set(unmatchedStripeCharges.map((row) => row.customer))].slice(0, 5);
      anomalies.push({
        audit_id: auditId,
        category: "pricing_mismatch",
        customer_id: "MULTIPLE",
        status: "detected",
        confidence: "high",
        annual_impact: totalUnmatched / 100,
        monthly_impact: totalUnmatched / 100,
        description: `${unmatchedStripeCharges.length} Stripe charge(s) totaling ${formatCurrency(totalUnmatched, currencyCode)} have no matching DB transaction. Sample customers: ${customers.join(", ")}...`,
        root_cause: "Missing internal ledger entries or delayed ingestion of Stripe charges.",
        recommendation: "Backfill missing DB records from Stripe and monitor ingestion latency.",
        detected_at: now,
        metadata: {
          count: unmatchedStripeCharges.length,
          total_amount: totalUnmatched,
          sample_charge_ids: unmatchedStripeCharges.map((row) => row.id).slice(0, 5),
          detection_method: "stripe_charge_without_db_match",
          confidence_reason: "No DB transaction found with same customer and amount.",
          impact_type: "probable",
        },
      });
    }

    // ========================================================================
    // ANOMALY 4: Unreconciled transactions (missing payout_id)
    // ========================================================================
    const payoutGraceDays = config.payoutGraceDays;
    const latestStripeDate = stripeRows
      .map((row) => parseDate(row.created))
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const payoutCutoff = latestStripeDate
      ? new Date(latestStripeDate.getTime() - payoutGraceDays * 24 * 60 * 60 * 1000)
      : null;

    const unreconciledCharges = stripeRows.filter((row) => {
      if (row.object === "refund") return false;
      if (row.status?.toLowerCase() !== "succeeded") return false;
      if (row.payout_id && row.payout_id.trim() !== "") return false;
      if (!payoutCutoff) return true;
      const createdAt = parseDate(row.created);
      return !createdAt || createdAt <= payoutCutoff;
    });

    if (unreconciledCharges.length > 0) {
      const totalUnreconciled = unreconciledCharges.reduce((sum, c) => sum + parseAmount(c.amount), 0);
      const customers = [...new Set(unreconciledCharges.map(c => c.customer))].slice(0, 5);
      
      anomalies.push({
        audit_id: auditId,
        category: "unbilled_usage",
        customer_id: "MULTIPLE",
        status: "detected",
        confidence: "medium",
        annual_impact: (totalUnreconciled / 100) * config.unreconciledRiskPct,
        monthly_impact: ((totalUnreconciled / 100) * config.unreconciledRiskPct) / 12,
        description: `${unreconciledCharges.length} transaction(s) totaling ${formatCurrency(totalUnreconciled, currencyCode)} are pending payout (no payout_id) beyond a ${payoutGraceDays}-day grace period. Affected customers: ${customers.join(", ")}...`,
        root_cause: "Transactions are in processing queue, payout schedule delay, or bank transfer pending.",
        recommendation: "Review Stripe payout schedule. Verify bank account is properly connected. Check for any holds on the account.",
        detected_at: now,
        metadata: { 
          count: unreconciledCharges.length, 
          total_amount: totalUnreconciled,
          transaction_ids: unreconciledCharges.map(c => c.id).slice(0, 10),
          payout_grace_days: payoutGraceDays,
          payout_cutoff: payoutCutoff?.toISOString() ?? null,
          detection_method: "stripe_succeeded_without_payout_id",
          confidence_reason: "Stripe charge succeeded but payout_id missing beyond grace period.",
          impact_type: "potential",
        },
      });
    }

    // ========================================================================
    // ANOMALY 5: Fee discrepancies between DB and Stripe
    // ========================================================================
    let totalFeeDiscrepancy = 0;
    const feeDiscrepancies: { customer: string; dbFee: number; stripeFee: number; diff: number }[] = [];

    for (const dbRow of dbRows) {
      if (!dbRow.fee_amount || dbRow.status?.toLowerCase() !== "succeeded") continue;
      
      const stripeMatch = stripeRows.find(s => 
        s.customer === dbRow.customer_id && 
        parseAmount(s.amount) === parseAmount(dbRow.amount) &&
        s.status?.toLowerCase() === "succeeded"
      );
      
      if (stripeMatch && stripeMatch.fee) {
        const dbFee = parseAmount(dbRow.fee_amount);
        const stripeFee = parseAmount(stripeMatch.fee);
        const diff = Math.abs(dbFee - stripeFee);
        
        if (diff > 0) {
          totalFeeDiscrepancy += diff;
          feeDiscrepancies.push({
            customer: dbRow.customer_id || "unknown",
            dbFee,
            stripeFee,
            diff
          });
        }
      }
    }

    if (totalFeeDiscrepancy > config.feeDiscrepancyThresholdCents) {
      anomalies.push({
        audit_id: auditId,
        category: "pricing_mismatch",
        customer_id: "MULTIPLE",
        status: "detected",
        confidence: feeDiscrepancies.length > 5 ? "high" : "medium",
        annual_impact: totalFeeDiscrepancy / 100,
        monthly_impact: totalFeeDiscrepancy / 100,
        description: `Fee discrepancy detected across ${feeDiscrepancies.length} transaction(s). Total difference: ${formatCurrency(totalFeeDiscrepancy, currencyCode)}. DB fees don't match Stripe fees.`,
        root_cause: "Rounding differences, different fee calculation methods, or outdated fee rates in internal system.",
        recommendation: "Audit fee calculation logic. Sync fee rates with current Stripe pricing. Consider using Stripe fees as source of truth.",
        detected_at: now,
        metadata: { 
          total_discrepancy: totalFeeDiscrepancy,
          transaction_count: feeDiscrepancies.length,
          samples: feeDiscrepancies.slice(0, 5),
          detection_method: "db_fee_vs_stripe_fee",
          confidence_reason: "Same customer+amount with different fee values.",
          impact_type: "probable",
        },
      });
    }

    // ========================================================================
    // ANOMALY 6: Timing mismatch (significant date differences)
    // ========================================================================
    for (const dbRow of dbRows) {
      const dbDate = parseDate(dbRow.created_at);
      if (!dbDate) continue;

      const stripeMatch = stripeRows.find(s => 
        s.customer === dbRow.customer_id && 
        parseAmount(s.amount) === parseAmount(dbRow.amount)
      );

      if (stripeMatch) {
        const stripeDate = parseDate(stripeMatch.created);
        if (stripeDate) {
          const diffMs = Math.abs(dbDate.getTime() - stripeDate.getTime());
          const diffDays = diffMs / (1000 * 60 * 60 * 24);
          
          if (diffDays > config.timingMismatchDays) {
            const amount = parseAmount(dbRow.amount);
            anomalies.push({
              audit_id: auditId,
              category: "other",
              customer_id: dbRow.customer_id || null,
              status: "detected",
              confidence: diffDays > 3 ? "high" : "medium",
              annual_impact: 0, // No direct financial impact
              monthly_impact: 0,
              description: `Timing mismatch for ${dbRow.customer_name || dbRow.customer_id}: DB shows ${dbDate.toISOString().split("T")[0]}, Stripe shows ${stripeDate.toISOString().split("T")[0]} (${Math.round(diffDays)} days difference). Amount: ${formatCurrency(amount, currencyCode)}`,
              root_cause: "Timezone differences, processing delays, or manual entry discrepancies.",
              recommendation: "Standardize timestamp handling. Use Stripe created_at as source of truth for reporting.",
              detected_at: now,
              metadata: { 
                db_date: dbDate.toISOString(), 
                stripe_date: stripeDate.toISOString(),
                diff_days: diffDays,
                amount,
                detection_method: "db_created_vs_stripe_created_date_diff",
                confidence_reason: "Dates differ beyond configured threshold.",
                impact_type: "informational",
              },
            });
          }
        }
      }
    }

    // ========================================================================
    // ANOMALY 7: Refund structure differences
    // ========================================================================
    const dbRefunds = dbRows.filter(r => 
      r.status?.toLowerCase() === "refunded" || 
      parseAmount(r.amount) < 0
    );
    
    const stripeRefundObjects = stripeRows.filter((r) => r.object === "refund");
    const stripeCharges = stripeRows.filter((r) => r.object !== "refund");

    if (dbRefunds.length > 0) {
      const unmatchedRefunds: typeof dbRows = [];
      const mismatchedRefunds: typeof dbRows = [];
      
      for (const dbRefund of dbRefunds) {
        const amount = Math.abs(parseAmount(dbRefund.amount));
        
        const hasStripeRefundObject = stripeRefundObjects.some((r) => {
          if (dbRefund.invoice_id && r.invoice) {
            return r.invoice === dbRefund.invoice_id;
          }
          if (dbRefund.customer_id && r.customer) {
            return r.customer === dbRefund.customer_id && parseAmount(r.amount) === amount;
          }
          return parseAmount(r.amount) === amount;
        });
        const hasAmountRefunded = stripeCharges.some((r) => {
          if (dbRefund.invoice_id && r.invoice) {
            return r.invoice === dbRefund.invoice_id && parseAmount(r.amount_refunded) >= amount;
          }
          if (dbRefund.customer_id && r.customer) {
            return r.customer === dbRefund.customer_id && parseAmount(r.amount_refunded) >= amount;
          }
          return parseAmount(r.amount_refunded) >= amount;
        });
        
        if (!hasStripeRefundObject && !hasAmountRefunded) {
          unmatchedRefunds.push(dbRefund);
        } else if (hasStripeRefundObject && !hasAmountRefunded) {
          mismatchedRefunds.push(dbRefund);
        }
      }

      if (unmatchedRefunds.length > 0) {
        const totalUnmatched = unmatchedRefunds.reduce((sum, r) => sum + Math.abs(parseAmount(r.amount)), 0);
        anomalies.push({
          audit_id: auditId,
          category: "high_refund_rate",
          customer_id: "MULTIPLE",
          status: "detected",
          confidence: "high",
          annual_impact: totalUnmatched / 100,
          monthly_impact: totalUnmatched / 100 / 12,
          description: `${unmatchedRefunds.length} refund(s) in DB totaling ${formatCurrency(totalUnmatched, currencyCode)} cannot be matched to Stripe refund records.`,
          root_cause: "Different refund recording methods between DB and Stripe (inline amount_refunded vs separate refund object).",
          recommendation: "Standardize refund tracking. Cross-reference with Stripe refund events. Verify all refunds are properly processed.",
          detected_at: now,
          metadata: { 
            unmatched_count: unmatchedRefunds.length,
            total_amount: totalUnmatched,
            db_refunds: unmatchedRefunds.map(r => r.transaction_id).slice(0, 5),
            detection_method: "db_refund_without_stripe_refund",
            confidence_reason: "No refund object or amount_refunded match in Stripe.",
            impact_type: "probable",
          },
        });
      }

      if (mismatchedRefunds.length > 0) {
        const totalMismatched = mismatchedRefunds.reduce((sum, r) => sum + Math.abs(parseAmount(r.amount)), 0);
        anomalies.push({
          audit_id: auditId,
          category: "high_refund_rate",
          customer_id: "MULTIPLE",
          status: "detected",
          confidence: "medium",
          annual_impact: totalMismatched / 100,
          monthly_impact: totalMismatched / 100 / 12,
          description: `${mismatchedRefunds.length} refund(s) in DB totaling ${formatCurrency(totalMismatched, currencyCode)} have refund objects in Stripe, but charge.amount_refunded is not updated.`,
          root_cause: "Stripe refund objects recorded separately without updating amount_refunded on the charge.",
          recommendation: "Normalize refund tracking: reconcile refund objects to charges and ensure amount_refunded is updated or ignored consistently.",
          detected_at: now,
          metadata: {
            mismatched_count: mismatchedRefunds.length,
            total_amount: totalMismatched,
            db_refunds: mismatchedRefunds.map((r) => r.transaction_id).slice(0, 5),
            detection_method: "stripe_refund_object_without_amount_refunded",
            confidence_reason: "Refund object exists but charge.amount_refunded is zero.",
            impact_type: "informational",
          },
        });
      }
    }

    // ========================================================================
    // ANOMALY 8: Payout grouping analysis
    // ========================================================================
    const payoutGroups = new Map<string, typeof stripeRows[0][]>();
    for (const row of stripeRows) {
      if (row.payout_id && row.payout_id.trim() !== "") {
        if (!payoutGroups.has(row.payout_id)) payoutGroups.set(row.payout_id, []);
        payoutGroups.get(row.payout_id)!.push(row);
      }
    }

    const largePayouts = [...payoutGroups.entries()]
      .filter(([_, txns]) => txns.length >= config.payoutGroupMinTransactions)
      .sort((a, b) => b[1].length - a[1].length);

    if (largePayouts.length > 0) {
      const [payoutId, transactions] = largePayouts[0];
      const totalAmount = transactions.reduce((sum, t) => sum + parseAmount(t.net || t.amount), 0);
      
      anomalies.push({
        audit_id: auditId,
        category: "other",
        customer_id: "PAYOUT",
        status: "detected",
        confidence: "low",
        annual_impact: 0,
        monthly_impact: 0,
        description: `Grouped payout detected: ${payoutId} bundles ${transactions.length} transactions totaling ${formatCurrency(totalAmount, currencyCode)}. Individual transaction matching may be complex.`,
        root_cause: "Stripe batches multiple transactions into single bank transfers based on payout schedule.",
        recommendation: "For accurate reconciliation, match individual transactions first, then verify payout totals against bank statements.",
        detected_at: now,
        metadata: { 
          payout_id: payoutId,
          transaction_count: transactions.length,
          total_amount: totalAmount,
          total_grouped_payouts: largePayouts.length
        },
      });
    }

    // ========================================================================
    // SUMMARY: Calculate totals and check for gross discrepancies
    // ========================================================================
    const dbTotalGross = dbRows
      .filter(r => r.status?.toLowerCase() === "succeeded")
      .reduce((sum, r) => sum + parseAmount(r.amount), 0);
    
    const stripeTotalGross = stripeRows
      .filter(r => r.object !== "refund" && r.status?.toLowerCase() === "succeeded")
      .reduce((sum, r) => sum + parseAmount(r.amount), 0);

    const grossDiff = Math.abs(dbTotalGross - stripeTotalGross);
    
    if (grossDiff > config.grossDiffThresholdCents) {
      anomalies.push({
        audit_id: auditId,
        category: "revenue_leakage",
        customer_id: "SUMMARY",
        status: "detected",
        confidence: grossDiff > 10000 ? "high" : "medium",
        annual_impact: grossDiff / 100,
        monthly_impact: grossDiff / 100,
        description: `Gross revenue discrepancy: DB shows ${formatCurrency(dbTotalGross, currencyCode)}, Stripe shows ${formatCurrency(stripeTotalGross, currencyCode)}. Difference: ${formatCurrency(grossDiff, currencyCode)}`,
        root_cause: "Duplicate transactions in Stripe, missing transactions in DB, or timing differences.",
        recommendation: "Perform line-by-line reconciliation. Identify and resolve individual transaction discrepancies.",
        detected_at: now,
        metadata: { 
          db_gross: dbTotalGross,
          stripe_gross: stripeTotalGross,
          difference: grossDiff,
          detection_method: "summary_gross_total_diff",
          confidence_reason: "Aggregated gross totals differ beyond configured threshold.",
          impact_type: "probable",
        },
      });
    }

  } else {
    // ========================================================================
    // MODE: Usage Logs vs Stripe (Original behavior - backward compatible)
    // ========================================================================
    
    const usageMapping: Record<string, string | null> = {};
    for (const [key, hints] of Object.entries(USAGE_COLUMN_HINTS)) {
      usageMapping[key] = findColumn(file1Headers, hints);
    }

    const stripeMapping: Record<string, string | null> = {};
    for (const [key, hints] of Object.entries(STRIPE_COLUMN_HINTS)) {
      stripeMapping[key] = findColumn(file2Headers, hints);
    }

    const usageRows = file1Rows.map((row) => mapRow(row, usageMapping));
    const stripeRows = file2Rows.map((row) => mapRow(row, stripeMapping));

    // Build customer maps
    const usageByCustomer = new Map<string, typeof usageRows>();
    for (const row of usageRows) {
      const customerId = row.customer_id?.trim();
      if (!customerId) continue;
      if (!usageByCustomer.has(customerId)) usageByCustomer.set(customerId, []);
      usageByCustomer.get(customerId)!.push(row);
    }

    const stripeByCustomer = new Map<string, typeof stripeRows>();
    for (const row of stripeRows) {
      const customerId = row.customer?.trim();
      if (!customerId) continue;
      if (!stripeByCustomer.has(customerId)) stripeByCustomer.set(customerId, []);
      stripeByCustomer.get(customerId)!.push(row);
    }

    const allCustomerIds = new Set([...usageByCustomer.keys(), ...stripeByCustomer.keys()]);

    for (const customerId of allCustomerIds) {
      const usageEvents = usageByCustomer.get(customerId) ?? [];
      const stripeCharges = stripeByCustomer.get(customerId) ?? [];
      
      const succeededCharges = stripeCharges.filter((c) => 
        c.status?.toLowerCase() === "succeeded" || c.status?.toLowerCase() === "paid"
      );
      const failedCharges = stripeCharges.filter((c) => 
        c.status?.toLowerCase() === "failed"
      );
      const refundedCharges = stripeCharges.filter((c) => 
        c.status?.toLowerCase() === "refunded" || Number(c.amount_refunded) > 0
      );
      const disputedCharges = stripeCharges.filter((c) => 
        c.status?.toLowerCase() === "disputed" || c.disputed === "true"
      );

      const totalUsage = usageEvents.reduce((sum, e) => sum + (Number(e.quantity) || 0), 0);
      const totalCharged = succeededCharges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0) / 100;
      const totalFailed = failedCharges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0) / 100;
      const totalRefunded = refundedCharges.reduce((sum, c) => sum + (Number(c.amount_refunded || c.amount) || 0), 0) / 100;
      const totalDisputed = disputedCharges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0) / 100;

      // ZOMBIE SUBSCRIPTION
      if (succeededCharges.length > 0 && usageEvents.length === 0) {
        anomalies.push({
          audit_id: auditId,
          category: "zombie_subscription",
          customer_id: customerId,
          status: "detected",
          confidence: succeededCharges.length >= 3 ? "high" : succeededCharges.length >= 2 ? "medium" : "low",
          annual_impact: totalCharged * 12,
          monthly_impact: totalCharged,
          description: `Customer ${customerId} has ${succeededCharges.length} successful charge(s) totaling $${totalCharged.toFixed(2)} but zero usage events.`,
          root_cause: "Customer may have churned, suspended usage, or the product is no longer being used while billing continues.",
          recommendation: "Contact customer to verify continued usage. Consider pausing subscription or offering a re-engagement incentive.",
          detected_at: now,
          metadata: { charges: succeededCharges.length, total: totalCharged },
        });
      }

      // UNBILLED USAGE
      if (usageEvents.length > 0 && succeededCharges.length === 0) {
        const estimatedRevenue = totalUsage * 0.05;
        anomalies.push({
          audit_id: auditId,
          category: "unbilled_usage",
          customer_id: customerId,
          status: "detected",
          confidence: usageEvents.length >= 5 ? "high" : usageEvents.length >= 2 ? "medium" : "low",
          annual_impact: estimatedRevenue * 12,
          monthly_impact: estimatedRevenue,
          description: `Customer ${customerId} has ${usageEvents.length} usage event(s) (${totalUsage} units) but no successful payments.`,
          root_cause: "Billing configuration issue, missing payment method, free trial not converted, or invoicing delay.",
          recommendation: "Review billing setup. If trial user, implement conversion campaign. Ensure metered billing is correctly configured.",
          detected_at: now,
          metadata: { events: usageEvents.length, units: totalUsage },
        });
      }

      // FAILED PAYMENTS
      if (failedCharges.length > 0) {
        anomalies.push({
          audit_id: auditId,
          category: "failed_payment",
          customer_id: customerId,
          status: "detected",
          confidence: "high",
          annual_impact: totalFailed * 12,
          monthly_impact: totalFailed,
          description: `Customer ${customerId} has ${failedCharges.length} failed payment(s) totaling $${totalFailed.toFixed(2)}.`,
          root_cause: "Card declined, insufficient funds, expired payment method, or bank rejection.",
          recommendation: "Implement dunning email sequence. Request updated payment method. Consider offering alternative payment options.",
          detected_at: now,
          metadata: { failed_count: failedCharges.length, failed_amount: totalFailed },
        });
      }

      // HIGH REFUND RATE
      if (totalRefunded > 0 && totalRefunded > totalCharged * 0.1) {
        anomalies.push({
          audit_id: auditId,
          category: "high_refund_rate",
          customer_id: customerId,
          status: "detected",
          confidence: totalRefunded > totalCharged * 0.25 ? "high" : "medium",
          annual_impact: totalRefunded * 6,
          monthly_impact: totalRefunded,
          description: `Customer ${customerId} has ${refundedCharges.length} refund(s) totaling $${totalRefunded.toFixed(2)} (${((totalRefunded / (totalCharged + totalRefunded)) * 100).toFixed(0)}% refund rate).`,
          root_cause: "Product dissatisfaction, billing disputes, accidental charges, or unclear pricing.",
          recommendation: "Review refund reasons. Improve onboarding and product value communication. Consider clearer pricing page.",
          detected_at: now,
          metadata: { refund_count: refundedCharges.length, refund_amount: totalRefunded },
        });
      }

      // DISPUTES / CHARGEBACKS
      if (disputedCharges.length > 0) {
        anomalies.push({
          audit_id: auditId,
          category: "dispute_chargeback",
          customer_id: customerId,
          status: "detected",
          confidence: "high",
          annual_impact: totalDisputed * 12 + (disputedCharges.length * 15),
          monthly_impact: totalDisputed + (disputedCharges.length * 15),
          description: `Customer ${customerId} has ${disputedCharges.length} disputed charge(s) totaling $${totalDisputed.toFixed(2)} plus ~$${disputedCharges.length * 15} in fees.`,
          root_cause: "Customer did not recognize charge, fraud, or service not delivered as expected.",
          recommendation: "Improve descriptor clarity. Respond to disputes promptly with evidence. Review fraud prevention measures.",
          detected_at: now,
          metadata: { dispute_count: disputedCharges.length, dispute_amount: totalDisputed },
        });
      }

      // DUPLICATE CHARGES
      if (succeededCharges.length >= 2) {
        const chargesByDate = new Map<string, typeof succeededCharges>();
        for (const charge of succeededCharges) {
          const timestamp = Number(charge.created);
          const date = isNaN(timestamp) 
            ? charge.created?.split("T")[0] 
            : new Date(timestamp * 1000).toISOString().split("T")[0];
          if (!date) continue;
          if (!chargesByDate.has(date)) chargesByDate.set(date, []);
          chargesByDate.get(date)!.push(charge);
        }

        for (const [date, charges] of chargesByDate) {
          if (charges.length >= 2) {
            const amounts = charges.map((c) => Number(c.amount) || 0);
            const duplicateAmounts = amounts.filter((a, i) => amounts.indexOf(a) !== i);
            if (duplicateAmounts.length > 0) {
              const duplicateAmount = duplicateAmounts[0] / 100;
              anomalies.push({
                audit_id: auditId,
                category: "duplicate_charge",
                customer_id: customerId,
                status: "detected",
                confidence: "high",
                annual_impact: duplicateAmount,
                monthly_impact: duplicateAmount,
                description: `Customer ${customerId} has ${charges.length} identical charges of $${duplicateAmount.toFixed(2)} on ${date}.`,
                root_cause: "Double-click on payment button, webhook retry issue, or manual billing error.",
                recommendation: "Implement idempotency keys. Review and refund confirmed duplicates. Add frontend debouncing.",
                detected_at: now,
                metadata: { date, charge_count: charges.length, amount: duplicateAmount },
              });
            }
          }
        }
      }
    }
  }

  // VALID database categories - from CHECK constraint
  // CHECK ((category = ANY (ARRAY['zombie_subscription', 'unbilled_usage', 'pricing_mismatch', 'duplicate_charge'])))
  const VALID_CATEGORIES = ["zombie_subscription", "unbilled_usage", "pricing_mismatch", "duplicate_charge"] as const;
  type ValidCategory = typeof VALID_CATEGORIES[number];

  // Map all categories to one of the 4 valid database categories
  const categoryMapping: Record<string, ValidCategory> = {
    // Direct mappings
    zombie_subscription: "zombie_subscription",
    unbilled_usage: "unbilled_usage",
    pricing_mismatch: "pricing_mismatch",
    duplicate_charge: "duplicate_charge",
    // Extended categories mapped to closest match
    failed_payment: "pricing_mismatch",       // Payment issues → pricing
    high_refund_rate: "pricing_mismatch",     // Refund issues → pricing
    dispute_chargeback: "pricing_mismatch",   // Disputes → pricing/payment issues
    trial_abuse: "unbilled_usage",            // Trial abuse → unbilled
    revenue_leakage: "unbilled_usage",        // Revenue leakage → unbilled
    involuntary_churn: "zombie_subscription", // Churn risk → zombie
    other: "pricing_mismatch",                // Default to pricing
  };

  // VALID status values
  const VALID_STATUSES = ["detected", "verified", "resolved", "dismissed"] as const;
  
  // VALID confidence values
  const VALID_CONFIDENCES = ["low", "medium", "high"] as const;

  // Insert anomalies
  if (anomalies.length > 0) {
    // Collect all unique categories being used for debugging
    const uniqueCategories = [...new Set(anomalies.map(a => a.category))];
    console.log("Original categories in anomalies:", uniqueCategories);

    // Sanitize and validate all anomalies before insert
    const sanitizedAnomalies = anomalies.map(a => {
    // Map category to valid value, default to "pricing_mismatch"
      let mappedCategory = categoryMapping[a.category];
      
    // If not found in mapping, default to "pricing_mismatch"
      if (!mappedCategory) {
      console.warn(`Unknown category "${a.category}", mapping to "pricing_mismatch"`);
      mappedCategory = "pricing_mismatch";
      }
      
      // Double-check it's a valid category (one of the 4 allowed)
      if (!VALID_CATEGORIES.includes(mappedCategory as ValidCategory)) {
        console.error(`Invalid mapped category "${mappedCategory}", forcing to "pricing_mismatch"`);
        mappedCategory = "pricing_mismatch";
      }
      
      // Use the mapped category (now guaranteed to be one of 4 valid values)
      
      // Validate status, default to "detected"
      const validStatus = VALID_STATUSES.includes(a.status as typeof VALID_STATUSES[number]) 
        ? a.status 
        : "detected";
      
      // Validate confidence, default to "medium"
      const validConfidence = VALID_CONFIDENCES.includes(a.confidence as typeof VALID_CONFIDENCES[number])
        ? a.confidence
        : "medium";

      return {
        audit_id: a.audit_id,
        category: mappedCategory,
        customer_id: a.customer_id || "SYSTEM",
        status: validStatus,
        confidence: validConfidence,
        annual_impact: typeof a.annual_impact === "number" ? a.annual_impact : 0,
        monthly_impact: typeof a.monthly_impact === "number" ? a.monthly_impact : 0,
        description: typeof a.description === "string" ? a.description : null,
        root_cause: typeof a.root_cause === "string" ? a.root_cause : null,
        recommendation: typeof a.recommendation === "string" ? a.recommendation : null,
        detected_at: a.detected_at || new Date().toISOString(),
        metadata: a.metadata 
          ? JSON.parse(JSON.stringify({ ...a.metadata, original_category: a.category })) 
          : { original_category: a.category },
      };
    });

    // Log all unique mapped categories
    const uniqueMappedCategories = [...new Set(sanitizedAnomalies.map(a => a.category))];
    console.log("Mapped categories being inserted:", uniqueMappedCategories);
    console.log("First anomaly sample:", JSON.stringify(sanitizedAnomalies[0], null, 2));

    const { error: insertError } = await adminSupabase.from("anomalies").insert(sanitizedAnomalies);
    if (insertError) {
      console.error("Failed to insert anomalies:", insertError);
      return NextResponse.json({ 
        error: "Failed to save anomalies.", 
        details: insertError.message,
        code: insertError.code,
        hint: insertError.hint,
        sample: sanitizedAnomalies[0],
        originalCategories: uniqueCategories,
        mappedCategories: uniqueMappedCategories
      }, { status: 500 });
    }
  }

  // Calculate totals
  const totalAnomalies = anomalies.length;
  const annualRevenueAtRisk = anomalies.reduce((sum, a) => sum + (a.annual_impact ?? 0), 0);

  // Determine date range from all data
  let periodStart: string | null = null;
  let periodEnd: string | null = null;

  const allTimestamps: number[] = [];
  for (const row of file1Rows) {
    const dateFields = ["created_at", "timestamp", "date", "created"];
    for (const field of dateFields) {
      const value = row[field as keyof typeof row];
      if (value) {
        const date = parseDate(String(value));
        if (date) allTimestamps.push(date.getTime());
      }
    }
  }
  for (const row of file2Rows) {
    const dateFields = ["created", "date", "timestamp"];
    for (const field of dateFields) {
      const value = row[field as keyof typeof row];
      if (value) {
        const date = parseDate(String(value));
        if (date) allTimestamps.push(date.getTime());
      }
    }
  }

  if (allTimestamps.length > 0) {
    periodStart = new Date(Math.min(...allTimestamps)).toISOString();
    periodEnd = new Date(Math.max(...allTimestamps)).toISOString();
  }

  // Generate AI insights if OpenAI is configured
  let aiInsights: string | null = null;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (openaiKey && anomalies.length > 0) {
    try {
      const anomalySummary = anomalies.slice(0, 10).map((a) => ({
        category: a.category,
        impact: a.annual_impact,
        description: a.description,
      }));

      const prompt = `You are a SaaS revenue analyst. Based on these detected anomalies from a billing reconciliation audit, provide a brief executive summary (3-4 sentences) of the key revenue risks and top priority actions:

${JSON.stringify(anomalySummary, null, 2)}

Total anomalies: ${totalAnomalies}
Annual revenue at risk: €${annualRevenueAtRisk.toFixed(0)}

Be specific and actionable. Focus on the highest-impact items. Mention specific amounts when relevant.`;

      const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 300,
          temperature: 0.7,
        }),
      });

      if (openaiResponse.ok) {
        const openaiData = await openaiResponse.json();
        aiInsights = openaiData.choices?.[0]?.message?.content ?? null;
      }
    } catch (e) {
      console.error("OpenAI error:", e);
    }
  }

  // Update audit
  const updateData: Record<string, unknown> = {
    status: "review",
    total_anomalies: totalAnomalies,
    annual_revenue_at_risk: Math.round(annualRevenueAtRisk * 100) / 100,
    audit_period_start: periodStart,
    audit_period_end: periodEnd,
  };

  const { error: updateError } = await adminSupabase.from("audits").update(updateData).eq("id", auditId);

  if (updateError) {
    console.error("Failed to update audit:", updateError);
  }

  return NextResponse.json({
    success: true,
    anomaliesDetected: totalAnomalies,
    annualRevenueAtRisk: Math.round(annualRevenueAtRisk * 100) / 100,
    aiInsights,
    mode: isDbTransactionLog ? "full_reconciliation" : "usage_vs_stripe",
  });
}
