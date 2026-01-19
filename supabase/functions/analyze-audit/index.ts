import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import Papa from "https://esm.sh/papaparse@5.4.1";

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
  description: ["description", "memo", "note", "product", "plan", "statement_descriptor"],
  customer_email: ["customer_email", "email", "receipt_email"],
  customer_name: ["customer_name", "name", "customer_description"],
  amount_refunded: ["amount_refunded", "refunded", "refund_amount"],
  disputed: ["disputed", "dispute", "is_disputed"],
  object: ["object", "type", "record_type"],
  payout_id: ["payout_id", "payout", "transfer_id", "destination"],
  balance_transaction: ["balance_transaction", "balance_txn", "txn"],
  payment_intent: ["payment_intent", "pi_id"],
  invoice: ["invoice", "invoice_id", "inv_id"],
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
  const num = Number(value);
  if (!isNaN(num) && num > 1000000000) {
    return new Date(num * 1000);
  }
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

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  console.log("[analyze-audit] Function invoked");
  
  if (req.method !== "POST") {
    console.log("[analyze-audit] Method not allowed:", req.method);
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let auditId: string | null = null;
  let config: Partial<ReconciliationConfig> | undefined;

  try {
    const body = await req.json();
    auditId = typeof body?.auditId === "string" ? body.auditId : null;
    config = body?.config as Partial<ReconciliationConfig> | undefined;
    console.log("[analyze-audit] Received auditId:", auditId);
  } catch (e) {
    console.error("[analyze-audit] Failed to parse JSON:", e);
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  if (!auditId) {
    console.log("[analyze-audit] Missing auditId");
    return jsonResponse({ error: "Audit ID is required." }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  console.log("[analyze-audit] SUPABASE_URL exists:", !!supabaseUrl);
  console.log("[analyze-audit] SERVICE_ROLE_KEY exists:", !!serviceRoleKey);

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[analyze-audit] Missing configuration - URL:", !!supabaseUrl, "Key:", !!serviceRoleKey);
    return jsonResponse({ error: "Server configuration missing. Check SUPABASE_SERVICE_ROLE_KEY secret." }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    console.log("[analyze-audit] Fetching audit metadata...");
    const { data: auditMeta, error: auditMetaError } = await supabase
      .from("audits")
      .select("id, organization_id")
      .eq("id", auditId)
      .maybeSingle();

    if (auditMetaError || !auditMeta) {
      console.error("[analyze-audit] Audit not found:", auditMetaError);
      return jsonResponse({ error: "Audit not found." }, 404);
    }
    console.log("[analyze-audit] Found audit for org:", auditMeta.organization_id);

    await supabase.from("audits").update({ status: "processing" }).eq("id", auditId);

    const { data: organization } = await supabase
      .from("organizations")
      .select("*")
      .eq("id", auditMeta.organization_id)
      .maybeSingle();

    const orgConfigRaw =
      organization && 
      organization.reconciliation_config !== null && 
      typeof organization.reconciliation_config === "object"
        ? (organization.reconciliation_config as Record<string, unknown>)
        : {};
    const orgConfigSettings =
      orgConfigRaw && typeof orgConfigRaw.settings === "object" && orgConfigRaw.settings !== null
        ? (orgConfigRaw.settings as Record<string, unknown>)
        : orgConfigRaw ?? {};

    const resolvedConfig = resolveConfig({
      ...(orgConfigSettings as Partial<ReconciliationConfig>),
      ...(config as Partial<ReconciliationConfig> | undefined),
    });

    console.log("[analyze-audit] Fetching uploaded files...");
    const { data: files, error: filesError } = await supabase
      .from("uploaded_files")
      .select("id, file_type, file_path")
      .eq("audit_id", auditId);

    console.log("[analyze-audit] Files found:", files?.length, "Error:", filesError);

    if (!files || files.length < 2) {
      console.error("[analyze-audit] Not enough files:", files?.length);
      await supabase.from("audits").update({ status: "error", error_message: "Both files are required." }).eq("id", auditId);
      return jsonResponse({ error: "Both files are required.", found: files?.length ?? 0 }, 400);
    }

    const file1 = files.find((f) => f.file_type === "usage_logs");
    const file2 = files.find((f) => f.file_type === "stripe_export");
    console.log("[analyze-audit] Usage logs file:", file1?.file_path);
    console.log("[analyze-audit] Stripe export file:", file2?.file_path);

    if (!file1 || !file2) {
      console.error("[analyze-audit] Missing file type - usage_logs:", !!file1, "stripe_export:", !!file2);
      await supabase.from("audits").update({ status: "error", error_message: "Both file types required." }).eq("id", auditId);
      return jsonResponse({ error: "Both files are required.", hasUsage: !!file1, hasStripe: !!file2 }, 400);
    }

    console.log("[analyze-audit] Downloading files from storage...");
    const { data: file1Data, error: file1Error } = await supabase.storage.from("audit-files").download(file1.file_path);
    const { data: file2Data, error: file2Error } = await supabase.storage.from("audit-files").download(file2.file_path);

    if (file1Error || file2Error) {
      console.error("[analyze-audit] Download errors - file1:", file1Error, "file2:", file2Error);
    }

    if (!file1Data || !file2Data) {
      console.error("[analyze-audit] Failed to download files");
      await supabase.from("audits").update({ status: "error", error_message: "Failed to download files from storage." }).eq("id", auditId);
      return jsonResponse({ error: "Failed to download files." }, 500);
    }

    console.log("[analyze-audit] Parsing CSV files...");
    const file1Text = await file1Data.text();
    const file2Text = await file2Data.text();
    console.log("[analyze-audit] File sizes - usage:", file1Text.length, "chars, stripe:", file2Text.length, "chars");

    const file1Result = Papa.parse<Record<string, string>>(file1Text, { header: true, skipEmptyLines: true });
    const file2Result = Papa.parse<Record<string, string>>(file2Text, { header: true, skipEmptyLines: true });
    console.log("[analyze-audit] Parsed rows - usage:", file1Result.data.length, "stripe:", file2Result.data.length);

    if (file1Result.errors.length > 0 || file2Result.errors.length > 0) {
      return jsonResponse(
        {
          error: "Failed to parse CSV files.",
          details: [
            ...file1Result.errors.map((err) => `usage_logs: ${err.message}`),
            ...file2Result.errors.map((err) => `stripe_export: ${err.message}`),
          ].join(" | "),
        },
        400
      );
    }

    const file1Headers = file1Result.meta.fields ?? [];
    const file2Headers = file2Result.meta.fields ?? [];

    if (file1Headers.length === 0 || file2Headers.length === 0) {
      return jsonResponse({ error: "CSV headers are missing." }, 400);
    }

    let file1Rows = file1Result.data.filter(
      (row): row is Record<string, string> => Boolean(row) && typeof row === "object"
    );
    let file2Rows = file2Result.data.filter(
      (row): row is Record<string, string> => Boolean(row) && typeof row === "object"
    );

    if (file1Rows.length === 0 || file2Rows.length === 0) {
      return jsonResponse({ error: "CSV files do not contain any valid rows." }, 400);
    }

    // ============================================================================
    // CLEANUP: Remove old queue entries and anomalies before re-running
    // ============================================================================
    console.log(`[analyze-audit] Cleaning up old data for audit ${auditId}`);
    await supabase.from("analysis_queue").delete().eq("audit_id", auditId);
    await supabase.from("anomalies").delete().eq("audit_id", auditId);

    // ============================================================================
    // BACKGROUND TASKS: Queue large files for chunked processing
    // ============================================================================
    const DIRECT_PROCESSING_LIMIT = 3000; // Process directly if under this limit
    const CHUNK_SIZE = 1000; // Rows per chunk for background processing
    const totalRows = Math.max(file1Rows.length, file2Rows.length);
    
    if (totalRows > DIRECT_PROCESSING_LIMIT) {
      console.log(`[analyze-audit] Large file detected (${totalRows} rows), queuing for background processing`);
      
      // Calculate number of chunks needed
      const numChunks = Math.ceil(totalRows / CHUNK_SIZE);
      
      // Create chunks in analysis_queue
      const chunks = [];
      for (let i = 0; i < numChunks; i++) {
        const startRow = i * CHUNK_SIZE;
        const endRow = Math.min((i + 1) * CHUNK_SIZE, totalRows);
        chunks.push({
          audit_id: auditId,
          status: "pending",
          chunk_index: i,
          total_chunks: numChunks,
          file1_start_row: Math.min(startRow, file1Rows.length),
          file1_end_row: Math.min(endRow, file1Rows.length),
          file2_start_row: Math.min(startRow, file2Rows.length),
          file2_end_row: Math.min(endRow, file2Rows.length),
        });
      }
      
      // Insert all chunks
      const { error: queueError } = await supabase.from("analysis_queue").insert(chunks);
      
      if (queueError) {
        console.error("[analyze-audit] Failed to create queue:", queueError);
        await supabase.from("audits").update({ status: "error", error_message: "Failed to queue analysis" }).eq("id", auditId);
        return jsonResponse({ error: "Failed to queue analysis" }, 500);
      }
      
      // Update audit status to queued
      await supabase.from("audits").update({
        status: "processing",
        is_chunked: true,
        chunks_total: numChunks,
        chunks_completed: 0,
      }).eq("id", auditId);
      
      console.log(`[analyze-audit] Queued ${numChunks} chunks for audit ${auditId}`);
      
      // Trigger first chunk processing immediately
      const edgeFunctionUrl = `${supabaseUrl}/functions/v1/process-chunk`;
      fetch(edgeFunctionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ trigger: "initial" }),
      }).catch((err) => console.error("[analyze-audit] Failed to trigger process-chunk:", err));
      
      return jsonResponse({
        success: true,
        status: "queued",
        message: `Large file queued for processing. ${numChunks} chunks created.`,
        chunks: numChunks,
      });
    }
    
    // ============================================================================
    // DIRECT PROCESSING: For files under the limit
    // ============================================================================
    const originalFile1Count = file1Rows.length;
    const originalFile2Count = file2Rows.length;
    let samplingNote = "";
    
    console.log(`[analyze-audit] Processing ${file1Rows.length} x ${file2Rows.length} rows`);

    const isDbTransactionLog = findColumn(file1Headers, ["transaction_id", "txn_id", "net_amount", "fee_amount"]) !== null;

    const anomalies: AnomalyInsert[] = [];
    const MAX_ANOMALIES_PER_CATEGORY = 50; // Limit anomalies per category
    const now = new Date().toISOString();

    if (isDbTransactionLog) {
      const dbMapping: Record<string, string | null> = {};
      for (const [key, hints] of Object.entries(DB_COLUMN_HINTS)) {
        dbMapping[key] = findColumn(file1Headers, hints);
      }

      const stripeMapping: Record<string, string | null> = {};
      for (const [key, hints] of Object.entries(STRIPE_COLUMN_HINTS)) {
        stripeMapping[key] = findColumn(file2Headers, hints);
      }

      const dbRows = file1Rows.map((row) => mapRow(row, dbMapping));
      const stripeRows = file2Rows.map((row) => mapRow(row, stripeMapping));
      const currencyCode =
        resolvedConfig.currencyCode ||
        stripeRows.find((row) => row.currency)?.currency?.toUpperCase() ||
        dbRows.find((row) => row.currency)?.currency?.toUpperCase() ||
        DEFAULT_CURRENCY;

      const stripeByCustomerAmount = new Map<string, typeof stripeRows[0][]>();
      for (const row of stripeRows) {
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

      const matchedStripeIds = new Set<string>();

      for (const dbRow of dbRows) {
        const status = dbRow.status?.toLowerCase();
        if (status === "failed") {
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
              annual_impact: (amount / 100) * resolvedConfig.annualizationMonths,
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

      const seenStripeCharges = new Map<string, typeof stripeRows[0][]>();
      for (const row of stripeRows) {
        if (row.object === "refund") continue;
        const key = `${row.customer}_${row.amount}_${parseDate(row.created)?.toISOString().split("T")[0]}`;
        if (!seenStripeCharges.has(key)) seenStripeCharges.set(key, []);
        seenStripeCharges.get(key)!.push(row);
      }

      for (const charges of seenStripeCharges.values()) {
        if (charges.length >= 2) {
          const amount = parseAmount(charges[0].amount);
          const customer = charges[0].customer;
          const ids = charges.map((c) => c.id).join(", ");
          anomalies.push({
            audit_id: auditId,
            category: "duplicate_charge",
            customer_id: customer || null,
            status: "detected",
            confidence: "high",
            annual_impact: amount / 100,
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

      for (const dbRow of dbRows) {
        if (dbRow.status?.toLowerCase() === "disputed") {
          const stripeMatch = stripeRows.find((s) =>
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
              annual_impact: amount / 100 + resolvedConfig.chargebackFeeAmount,
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

      const payoutGraceDays = resolvedConfig.payoutGraceDays;
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
        const customers = [...new Set(unreconciledCharges.map((c) => c.customer))].slice(0, 5);
        anomalies.push({
          audit_id: auditId,
          category: "unbilled_usage",
          customer_id: "MULTIPLE",
          status: "detected",
          confidence: "medium",
          annual_impact: (totalUnreconciled / 100) * resolvedConfig.unreconciledRiskPct,
          monthly_impact: ((totalUnreconciled / 100) * resolvedConfig.unreconciledRiskPct) / 12,
          description: `${unreconciledCharges.length} transaction(s) totaling ${formatCurrency(totalUnreconciled, currencyCode)} are pending payout (no payout_id) beyond a ${payoutGraceDays}-day grace period. Affected customers: ${customers.join(", ")}...`,
          root_cause: "Transactions are in processing queue, payout schedule delay, or bank transfer pending.",
          recommendation: "Review Stripe payout schedule. Verify bank account is properly connected. Check for any holds on the account.",
          detected_at: now,
          metadata: {
            count: unreconciledCharges.length,
            total_amount: totalUnreconciled,
            transaction_ids: unreconciledCharges.map((c) => c.id).slice(0, 10),
            payout_grace_days: payoutGraceDays,
            payout_cutoff: payoutCutoff?.toISOString() ?? null,
            detection_method: "stripe_succeeded_without_payout_id",
            confidence_reason: "Stripe charge succeeded but payout_id missing beyond grace period.",
            impact_type: "potential",
          },
        });
      }

      let totalFeeDiscrepancy = 0;
      const feeDiscrepancies: { customer: string; dbFee: number; stripeFee: number; diff: number }[] = [];

      for (const dbRow of dbRows) {
        if (!dbRow.fee_amount || dbRow.status?.toLowerCase() !== "succeeded") continue;

        const stripeMatch = stripeRows.find((s) =>
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
              diff,
            });
          }
        }
      }

      if (totalFeeDiscrepancy > resolvedConfig.feeDiscrepancyThresholdCents) {
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

      for (const dbRow of dbRows) {
        const dbDate = parseDate(dbRow.created_at);
        if (!dbDate) continue;

        const stripeMatch = stripeRows.find((s) =>
          s.customer === dbRow.customer_id &&
          parseAmount(s.amount) === parseAmount(dbRow.amount)
        );

        if (stripeMatch) {
          const stripeDate = parseDate(stripeMatch.created);
          if (stripeDate) {
            const diffMs = Math.abs(dbDate.getTime() - stripeDate.getTime());
            const diffDays = diffMs / (1000 * 60 * 60 * 24);

            if (diffDays > resolvedConfig.timingMismatchDays) {
              const amount = parseAmount(dbRow.amount);
              anomalies.push({
                audit_id: auditId,
                category: "other",
                customer_id: dbRow.customer_id || null,
                status: "detected",
                confidence: diffDays > 3 ? "high" : "medium",
                annual_impact: 0,
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

      const dbRefunds = dbRows.filter((r) =>
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
              db_refunds: unmatchedRefunds.map((r) => r.transaction_id).slice(0, 5),
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

      const payoutGroups = new Map<string, typeof stripeRows[0][]>();
      for (const row of stripeRows) {
        if (row.payout_id && row.payout_id.trim() !== "") {
          if (!payoutGroups.has(row.payout_id)) payoutGroups.set(row.payout_id, []);
          payoutGroups.get(row.payout_id)!.push(row);
        }
      }

      const largePayouts = [...payoutGroups.entries()]
        .filter(([_, txns]) => txns.length >= resolvedConfig.payoutGroupMinTransactions)
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
            total_grouped_payouts: largePayouts.length,
          },
        });
      }

      const dbTotalGross = dbRows
        .filter((r) => r.status?.toLowerCase() === "succeeded")
        .reduce((sum, r) => sum + parseAmount(r.amount), 0);

      const stripeTotalGross = stripeRows
        .filter((r) => r.object !== "refund" && r.status?.toLowerCase() === "succeeded")
        .reduce((sum, r) => sum + parseAmount(r.amount), 0);

      const grossDiff = Math.abs(dbTotalGross - stripeTotalGross);

      if (grossDiff > resolvedConfig.grossDiffThresholdCents) {
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

      // ============================================================================
      // NEW: Product/Plan Categorization Mismatch Detection (with error handling)
      // Skip for large files to avoid timeout
      // ============================================================================
      if (originalFile1Count <= 2000 && originalFile2Count <= 2000) try {
        const planKeywords: Record<string, string[]> = {
          starter: ["starter", "basic", "lite", "free"],
          premium: ["premium", "pro", "plus"],
          business: ["business", "team", "growth"],
          enterprise: ["enterprise", "custom", "unlimited"],
        };

        const detectPlanType = (text: string | undefined): string | null => {
          if (!text) return null;
          const lower = text.toLowerCase();
          for (const [plan, keywords] of Object.entries(planKeywords)) {
            if (keywords.some((kw) => lower.includes(kw))) return plan;
          }
          return null;
        };

        const categorizationMismatches: { customer: string; dbPlan: string; stripePlan: string; amount: number }[] = [];

        for (const dbRow of dbRows) {
          if (!dbRow || dbRow.status?.toLowerCase() !== "succeeded") continue;
          const dbPlan = detectPlanType(dbRow.description);
          if (!dbPlan) continue;

          const stripeMatch = stripeRows.find(
            (s) => s && s.customer === dbRow.customer_id && parseAmount(s.amount) === parseAmount(dbRow.amount)
          );

          if (stripeMatch) {
            const stripePlan = detectPlanType(stripeMatch.description);
            if (stripePlan && dbPlan !== stripePlan) {
              categorizationMismatches.push({
                customer: dbRow.customer_id || "unknown",
                dbPlan,
                stripePlan,
                amount: parseAmount(dbRow.amount),
              });
            }
          }
        }

        if (categorizationMismatches.length > 0) {
          const totalAmount = categorizationMismatches.reduce((sum, m) => sum + m.amount, 0);
          anomalies.push({
            audit_id: auditId,
            category: "pricing_mismatch",
            customer_id: "MULTIPLE",
            status: "detected",
            confidence: categorizationMismatches.length > 3 ? "high" : "medium",
            annual_impact: 0,
            monthly_impact: 0,
            description: `${categorizationMismatches.length} transaction(s) have mismatched plan categorizations between DB and Stripe. Example: DB shows "${categorizationMismatches[0]?.dbPlan || "unknown"}" but Stripe shows "${categorizationMismatches[0]?.stripePlan || "unknown"}".`,
            root_cause: "Statement descriptor or product metadata not synced with internal plan names.",
            recommendation: "Standardize product naming across systems.",
            detected_at: now,
            metadata: {
              count: categorizationMismatches.length,
              total_amount: totalAmount,
              samples: categorizationMismatches.slice(0, 5),
              detection_method: "plan_categorization_mismatch",
              impact_type: "informational",
            },
          });
        }
      } catch (e) {
        console.error("[analyze-audit] Plan categorization check failed:", e);
      }

      // ============================================================================
      // NEW: Email Integrity Check (with error handling)
      // Skip for large files to avoid timeout
      // ============================================================================
      if (originalFile1Count <= 2000 && originalFile2Count <= 2000) try {
        const emailMismatches: { customer: string; dbEmail: string; stripeEmail: string }[] = [];

        for (const dbRow of dbRows) {
          if (!dbRow || !dbRow.customer_email || dbRow.status?.toLowerCase() !== "succeeded") continue;

          const stripeMatch = stripeRows.find(
            (s) => s && s.customer === dbRow.customer_id && parseAmount(s.amount) === parseAmount(dbRow.amount)
          );

          if (stripeMatch && stripeMatch.customer_email) {
            const dbEmailNorm = (dbRow.customer_email || "").toLowerCase().trim();
            const stripeEmailNorm = (stripeMatch.customer_email || "").toLowerCase().trim();

            if (dbEmailNorm && stripeEmailNorm && dbEmailNorm !== stripeEmailNorm) {
              emailMismatches.push({
                customer: dbRow.customer_id || "unknown",
                dbEmail: dbRow.customer_email,
                stripeEmail: stripeMatch.customer_email,
              });
            }
          }
        }

        if (emailMismatches.length > 0) {
          anomalies.push({
            audit_id: auditId,
            category: "other",
            customer_id: "MULTIPLE",
            status: "detected",
            confidence: emailMismatches.length > 5 ? "high" : "medium",
            annual_impact: 0,
            monthly_impact: 0,
            description: `${emailMismatches.length} customer(s) have different email addresses in DB vs Stripe.`,
            root_cause: "Customer email updated in one system but not synchronized.",
            recommendation: "Implement bidirectional sync for customer profile changes.",
            detected_at: now,
            metadata: {
              count: emailMismatches.length,
              samples: emailMismatches.slice(0, 5),
              detection_method: "email_integrity_check",
              impact_type: "informational",
            },
          });
        }
      } catch (e) {
        console.error("[analyze-audit] Email integrity check failed:", e);
      }

      // ============================================================================
      // NEW: Invoice ID Cross-Reference Matching (with error handling)
      // Skip for large files to avoid timeout
      // ============================================================================
      if (originalFile1Count <= 2000 && originalFile2Count <= 2000) try {
        const invoiceMismatches: { dbInvoice: string; dbCustomer: string; amount: number }[] = [];

        for (const dbRow of dbRows) {
          if (!dbRow || !dbRow.invoice_id || dbRow.status?.toLowerCase() !== "succeeded") continue;

          const stripeByInvoice = stripeRows.find(
            (s) => s && (s.invoice === dbRow.invoice_id || s.payment_intent === dbRow.invoice_id)
          );

          if (!stripeByInvoice) {
            const stripeByCustomerAmount = stripeRows.find(
              (s) => s && s.customer === dbRow.customer_id && parseAmount(s.amount) === parseAmount(dbRow.amount)
            );

            if (!stripeByCustomerAmount) {
              invoiceMismatches.push({
                dbInvoice: dbRow.invoice_id,
                dbCustomer: dbRow.customer_id || "unknown",
                amount: parseAmount(dbRow.amount),
              });
            }
          }
        }

        if (invoiceMismatches.length > 0) {
          const totalAmount = invoiceMismatches.reduce((sum, m) => sum + m.amount, 0);
          anomalies.push({
            audit_id: auditId,
            category: "unbilled_usage",
            customer_id: "MULTIPLE",
            status: "detected",
            confidence: "high",
            annual_impact: totalAmount / 100,
            monthly_impact: totalAmount / 100,
            description: `${invoiceMismatches.length} invoice(s) in DB cannot be matched to any Stripe record. Total: ${formatCurrency(totalAmount, currencyCode)}`,
            root_cause: "Invoices generated but payments not captured in Stripe.",
            recommendation: "Cross-reference invoice IDs and check payment processing.",
            detected_at: now,
            metadata: {
              count: invoiceMismatches.length,
              total_amount: totalAmount,
              samples: invoiceMismatches.slice(0, 5),
              detection_method: "invoice_id_cross_reference",
              impact_type: "probable",
            },
          });
        }
      } catch (e) {
        console.error("[analyze-audit] Invoice cross-reference check failed:", e);
      }

      // ============================================================================
      // NEW: Cross-System Duplicate Detection (with error handling)
      // Skip for large files to avoid timeout
      // ============================================================================
      if (originalFile1Count <= 2000 && originalFile2Count <= 2000) try {
        const crossSystemDuplicates: { dbTxn: string; stripeTxn: string; customer: string; amount: number; timeDiff: number }[] = [];

        for (const dbRow of dbRows) {
          if (!dbRow || dbRow.status?.toLowerCase() !== "succeeded") continue;
          const dbDate = parseDate(dbRow.created_at);
          if (!dbDate) continue;

          const amount = parseAmount(dbRow.amount);
          if (amount <= 0) continue;

          const matchingStripeRows = stripeRows.filter(
            (s) =>
              s &&
              s.customer === dbRow.customer_id &&
              parseAmount(s.amount) === amount &&
              s.object !== "refund" &&
              s.status?.toLowerCase() === "succeeded"
          );

          if (matchingStripeRows.length > 1) {
            for (let i = 1; i < matchingStripeRows.length; i++) {
              const stripeRow = matchingStripeRows[i];
              if (!stripeRow) continue;
              
              const stripeDate = parseDate(stripeRow.created);
              const timeDiff = stripeDate ? Math.abs(dbDate.getTime() - stripeDate.getTime()) / (1000 * 60 * 60) : 0;
              
              if (timeDiff < 24) {
                crossSystemDuplicates.push({
                  dbTxn: dbRow.transaction_id || "unknown",
                  stripeTxn: stripeRow.id || "unknown",
                  customer: dbRow.customer_id || "unknown",
                  amount,
                  timeDiff: Math.round(timeDiff * 10) / 10,
                });
              }
            }
          }
        }

        if (crossSystemDuplicates.length > 0) {
          const totalAmount = crossSystemDuplicates.reduce((sum, d) => sum + d.amount, 0);
          anomalies.push({
            audit_id: auditId,
            category: "duplicate_charge",
            customer_id: "MULTIPLE",
            status: "detected",
            confidence: "high",
            annual_impact: totalAmount / 100,
            monthly_impact: totalAmount / 100,
            description: `${crossSystemDuplicates.length} potential cross-system duplicate(s) detected within 24 hours. Total at risk: ${formatCurrency(totalAmount, currencyCode)}`,
            root_cause: "Same transaction may have been recorded multiple times with different IDs.",
            recommendation: "Review flagged transactions and implement idempotency keys.",
            detected_at: now,
            metadata: {
              count: crossSystemDuplicates.length,
              total_amount: totalAmount,
              samples: crossSystemDuplicates.slice(0, 5),
              detection_method: "cross_system_duplicate_detection",
              impact_type: "probable",
            },
          });
        }
      } catch (e) {
        console.error("[analyze-audit] Cross-system duplicate check failed:", e);
      }
    } else {
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

    const VALID_CATEGORIES = ["zombie_subscription", "unbilled_usage", "pricing_mismatch", "duplicate_charge"] as const;
    type ValidCategory = typeof VALID_CATEGORIES[number];

    const categoryMapping: Record<string, ValidCategory> = {
      zombie_subscription: "zombie_subscription",
      unbilled_usage: "unbilled_usage",
      pricing_mismatch: "pricing_mismatch",
      duplicate_charge: "duplicate_charge",
      failed_payment: "pricing_mismatch",
      high_refund_rate: "pricing_mismatch",
      dispute_chargeback: "pricing_mismatch",
      trial_abuse: "unbilled_usage",
      revenue_leakage: "unbilled_usage",
      involuntary_churn: "zombie_subscription",
      other: "pricing_mismatch",
    };

    const VALID_STATUSES = ["detected", "verified", "resolved", "dismissed"] as const;
    const VALID_CONFIDENCES = ["low", "medium", "high"] as const;

    console.log("[analyze-audit] Total anomalies detected:", anomalies.length);
    
    if (anomalies.length > 0) {
      const uniqueCategories = [...new Set(anomalies.map((a) => a.category))];
      console.log("[analyze-audit] Anomaly categories:", uniqueCategories);

      const sanitizedAnomalies = anomalies.map((a) => {
        let mappedCategory = categoryMapping[a.category];
        if (!mappedCategory) {
          console.warn(`Unknown category "${a.category}", mapping to "pricing_mismatch"`);
          mappedCategory = "pricing_mismatch";
        }
        if (!VALID_CATEGORIES.includes(mappedCategory as ValidCategory)) {
          console.error(`Invalid mapped category "${mappedCategory}", forcing to "pricing_mismatch"`);
          mappedCategory = "pricing_mismatch";
        }

        const validStatus = VALID_STATUSES.includes(a.status as typeof VALID_STATUSES[number])
          ? a.status
          : "detected";
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

      console.log("[analyze-audit] Inserting", sanitizedAnomalies.length, "anomalies...");
      const { error: insertError } = await supabase.from("anomalies").insert(sanitizedAnomalies);
      if (insertError) {
        console.error("[analyze-audit] Failed to insert anomalies:", insertError);
        await supabase
          .from("audits")
          .update({ status: "error", error_message: insertError.message })
          .eq("id", auditId);
        return jsonResponse(
          {
            error: "Failed to save anomalies.",
            details: insertError.message,
            code: insertError.code,
            hint: insertError.hint,
            originalCategories: uniqueCategories,
          },
          500
        );
      }
      console.log("[analyze-audit] Anomalies inserted successfully");
    } else {
      console.log("[analyze-audit] No anomalies detected - this may indicate data format issues");
    }

    const totalAnomalies = anomalies.length;
    const annualRevenueAtRisk = anomalies.reduce((sum, a) => sum + (a.annual_impact ?? 0), 0);

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

    let aiInsights: string | null = null;
    const openaiKey = Deno.env.get("OPENAI_API_KEY");

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
      } catch (error) {
        console.error("OpenAI error:", error);
      }
    }

    const updateData: Record<string, unknown> = {
      status: "review",
      total_anomalies: totalAnomalies,
      annual_revenue_at_risk: Math.round(annualRevenueAtRisk * 100) / 100,
      audit_period_start: periodStart,
      audit_period_end: periodEnd,
      processed_at: new Date().toISOString(),
      ai_insights: samplingNote ? `${samplingNote}\n\n${aiInsights || ""}`.trim() : aiInsights,
      error_message: null,
    };

    console.log("[analyze-audit] Updating audit to 'review' status...");
    const { error: updateError } = await supabase.from("audits").update(updateData).eq("id", auditId);
    if (updateError) {
      console.error("[analyze-audit] Failed to update audit:", updateError);
    }

    console.log("[analyze-audit] ✅ Analysis complete! Anomalies:", totalAnomalies, "Revenue at risk:", annualRevenueAtRisk);

    return jsonResponse({
      success: true,
      anomaliesDetected: totalAnomalies,
      annualRevenueAtRisk: Math.round(annualRevenueAtRisk * 100) / 100,
      aiInsights,
      mode: isDbTransactionLog ? "full_reconciliation" : "usage_vs_stripe",
    });
  } catch (error) {
    console.error("Edge function error:", error);
    await supabase
      .from("audits")
      .update({ status: "error", error_message: error instanceof Error ? error.message : "Unknown error" })
      .eq("id", auditId);
    return jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});
