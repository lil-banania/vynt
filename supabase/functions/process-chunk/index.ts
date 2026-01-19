import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import Papa from "https://esm.sh/papaparse@5.4.1";

// ============================================================================
// COLUMN MAPPING - Same as analyze-audit
// ============================================================================
const DB_COLUMN_HINTS: Record<string, string[]> = {
  transaction_id: ["transaction_id", "txn_id", "id", "internal_id", "record_id", "event_id"],
  customer_id: ["customer_id", "customer", "cust_id", "user_id", "account_id", "client_id"],
  amount: ["amount", "gross_amount", "total", "charge_amount", "price", "value"],
  net_amount: ["net_amount", "net", "amount_net"],
  fee_amount: ["fee_amount", "fee", "fees", "stripe_fee", "processing_fee"],
  status: ["status", "state", "payment_status", "transaction_status"],
  created_at: ["created_at", "created", "timestamp", "date", "transaction_date"],
  description: ["description", "memo", "note", "product", "plan", "plan_name"],
  invoice_id: ["invoice_id", "invoice", "inv_id"],
  customer_email: ["customer_email", "email", "user_email"],
  currency: ["currency", "curr"],
};

const STRIPE_COLUMN_HINTS: Record<string, string[]> = {
  id: ["id", "charge_id", "payment_id", "transaction_id", "stripe_id"],
  customer: ["customer", "customer_id", "cust_id", "stripe_customer_id"],
  amount: ["amount", "total", "charge_amount", "price", "gross"],
  fee: ["fee", "stripe_fee", "processing_fee", "application_fee"],
  net: ["net", "net_amount", "amount_net"],
  status: ["status", "state", "payment_status", "charge_status"],
  created: ["created", "date", "timestamp", "created_at", "payment_date"],
  currency: ["currency", "curr"],
  description: ["description", "memo", "note", "product", "plan", "statement_descriptor"],
  customer_email: ["customer_email", "email", "receipt_email"],
  amount_refunded: ["amount_refunded", "refunded", "refund_amount"],
  invoice: ["invoice", "invoice_id", "inv_id"],
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

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  console.log("[process-chunk] Function invoked");

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Server configuration missing." }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // Get next pending chunk
    const { data: chunk, error: fetchError } = await supabase
      .from("analysis_queue")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      console.error("[process-chunk] Error fetching chunk:", fetchError);
      return jsonResponse({ error: "Failed to fetch queue" }, 500);
    }

    if (!chunk) {
      console.log("[process-chunk] No pending chunks");
      return jsonResponse({ message: "No pending chunks" });
    }

    console.log(`[process-chunk] Processing chunk ${chunk.chunk_index + 1}/${chunk.total_chunks} for audit ${chunk.audit_id}`);

    // Mark as processing
    await supabase
      .from("analysis_queue")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("id", chunk.id);

    // Get files
    const { data: files } = await supabase
      .from("uploaded_files")
      .select("id, file_type, file_path")
      .eq("audit_id", chunk.audit_id);

    if (!files || files.length < 2) {
      await supabase
        .from("analysis_queue")
        .update({ status: "error", error_message: "Files not found" })
        .eq("id", chunk.id);
      return jsonResponse({ error: "Files not found" }, 400);
    }

    const file1 = files.find((f) => f.file_type === "usage_logs");
    const file2 = files.find((f) => f.file_type === "stripe_export");

    if (!file1 || !file2) {
      await supabase
        .from("analysis_queue")
        .update({ status: "error", error_message: "Missing file type" })
        .eq("id", chunk.id);
      return jsonResponse({ error: "Missing file type" }, 400);
    }

    // Download and parse files
    const { data: file1Data } = await supabase.storage.from("audit-files").download(file1.file_path);
    const { data: file2Data } = await supabase.storage.from("audit-files").download(file2.file_path);

    if (!file1Data || !file2Data) {
      await supabase
        .from("analysis_queue")
        .update({ status: "error", error_message: "Failed to download files" })
        .eq("id", chunk.id);
      return jsonResponse({ error: "Failed to download files" }, 500);
    }

    const file1Text = await file1Data.text();
    const file2Text = await file2Data.text();

    const file1Result = Papa.parse<Record<string, string>>(file1Text, { header: true, skipEmptyLines: true });
    const file2Result = Papa.parse<Record<string, string>>(file2Text, { header: true, skipEmptyLines: true });

    const file1Headers = file1Result.meta.fields ?? [];
    const file2Headers = file2Result.meta.fields ?? [];

    // Get chunk slice
    const file1Rows = file1Result.data.slice(chunk.file1_start_row, chunk.file1_end_row);
    const file2Rows = file2Result.data.slice(chunk.file2_start_row, chunk.file2_end_row);

    console.log(`[process-chunk] Processing rows: file1[${chunk.file1_start_row}-${chunk.file1_end_row}], file2[${chunk.file2_start_row}-${chunk.file2_end_row}]`);

    // Build column mappings
    const dbMapping: Record<string, string | null> = {};
    for (const [key, hints] of Object.entries(DB_COLUMN_HINTS)) {
      dbMapping[key] = findColumn(file1Headers, hints);
    }

    const stripeMapping: Record<string, string | null> = {};
    for (const [key, hints] of Object.entries(STRIPE_COLUMN_HINTS)) {
      stripeMapping[key] = findColumn(file2Headers, hints);
    }

    const dbRows = file1Rows.map((row) => mapRow(row as Record<string, string>, dbMapping));
    const stripeRows = file2Rows.map((row) => mapRow(row as Record<string, string>, stripeMapping));

    // Build lookup maps for Stripe data
    const stripeByCustomerAmount = new Map<string, (typeof stripeRows)[0][]>();
    for (const row of stripeRows) {
      const key = `${row.customer}_${parseAmount(row.amount)}`;
      const existing = stripeByCustomerAmount.get(key) ?? [];
      existing.push(row);
      stripeByCustomerAmount.set(key, existing);
    }

    const anomalies: AnomalyInsert[] = [];
    const now = new Date().toISOString();
    const MAX_ANOMALIES_PER_CHUNK = 30;

    // ============================================================================
    // ANOMALY DETECTION - Simplified for chunk processing
    // ============================================================================

    // 1. Missing in Stripe (DB transaction not found in Stripe)
    let missingInStripeCount = 0;
    for (const dbRow of dbRows) {
      if (missingInStripeCount >= MAX_ANOMALIES_PER_CHUNK) break;
      const customerId = dbRow.customer_id;
      const amount = parseAmount(dbRow.amount);
      if (!customerId || amount <= 0) continue;

      const key = `${customerId}_${amount}`;
      const matches = stripeByCustomerAmount.get(key);
      
      if (!matches || matches.length === 0) {
        anomalies.push({
          audit_id: chunk.audit_id,
          category: "missing_in_stripe",
          customer_id: customerId,
          status: "open",
          confidence: "high",
          annual_impact: amount * 12,
          monthly_impact: amount,
          description: `Transaction of $${amount.toFixed(2)} for customer ${customerId} not found in Stripe`,
          root_cause: "Transaction exists in internal records but not in Stripe export",
          recommendation: "Verify if payment was processed or needs to be charged",
          detected_at: now,
          metadata: { db_transaction_id: dbRow.transaction_id, amount },
        });
        missingInStripeCount++;
      }
    }

    // 2. Amount mismatch (same customer, different amounts)
    let amountMismatchCount = 0;
    const processedCustomers = new Set<string>();
    for (const dbRow of dbRows) {
      if (amountMismatchCount >= MAX_ANOMALIES_PER_CHUNK) break;
      const customerId = dbRow.customer_id;
      if (!customerId || processedCustomers.has(customerId)) continue;
      processedCustomers.add(customerId);

      const dbAmount = parseAmount(dbRow.amount);
      if (dbAmount <= 0) continue;

      // Find any Stripe transaction for this customer
      for (const [key, matches] of stripeByCustomerAmount) {
        if (key.startsWith(customerId + "_")) {
          const stripeAmount = parseAmount(matches[0].amount);
          const diff = Math.abs(dbAmount - stripeAmount);
          if (diff > 0.01 && diff / Math.max(dbAmount, stripeAmount) > 0.05) {
            anomalies.push({
              audit_id: chunk.audit_id,
              category: "amount_mismatch",
              customer_id: customerId,
              status: "open",
              confidence: "medium",
              annual_impact: diff * 12,
              monthly_impact: diff,
              description: `Amount discrepancy: DB shows $${dbAmount.toFixed(2)}, Stripe shows $${stripeAmount.toFixed(2)}`,
              root_cause: "Amount in internal records doesn't match Stripe",
              recommendation: "Review pricing configuration and reconcile amounts",
              detected_at: now,
              metadata: { db_amount: dbAmount, stripe_amount: stripeAmount },
            });
            amountMismatchCount++;
            break;
          }
        }
      }
    }

    // 3. Failed/Incomplete transactions
    let failedTxnCount = 0;
    for (const stripeRow of stripeRows) {
      if (failedTxnCount >= MAX_ANOMALIES_PER_CHUNK) break;
      const status = stripeRow.status?.toLowerCase();
      if (status && ["failed", "incomplete", "canceled"].some((s) => status.includes(s))) {
        const amount = parseAmount(stripeRow.amount);
        if (amount > 0) {
          anomalies.push({
            audit_id: chunk.audit_id,
            category: "failed_transaction",
            customer_id: stripeRow.customer || null,
            status: "open",
            confidence: "high",
            annual_impact: amount * 12,
            monthly_impact: amount,
            description: `Failed/incomplete payment of $${amount.toFixed(2)} for customer ${stripeRow.customer || "unknown"}`,
            root_cause: `Payment status: ${status}`,
            recommendation: "Retry payment or contact customer",
            detected_at: now,
            metadata: { stripe_id: stripeRow.id, status },
          });
          failedTxnCount++;
        }
      }
    }

    console.log(`[process-chunk] Detected ${anomalies.length} anomalies in chunk ${chunk.chunk_index + 1}`);

    // Insert anomalies
    if (anomalies.length > 0) {
      const { error: insertError } = await supabase.from("anomalies").insert(anomalies);
      if (insertError) {
        console.error("[process-chunk] Failed to insert anomalies:", insertError);
      }
    }

    // Mark chunk as completed
    await supabase
      .from("analysis_queue")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        anomalies_found: anomalies.length,
      })
      .eq("id", chunk.id);

    // Update audit progress
    const { data: audit } = await supabase
      .from("audits")
      .select("chunks_completed, chunks_total")
      .eq("id", chunk.audit_id)
      .maybeSingle();

    if (audit) {
      const newCompleted = (audit.chunks_completed ?? 0) + 1;

      if (newCompleted >= audit.chunks_total) {
        // All chunks done - finalize
        const { count: anomalyCount } = await supabase
          .from("anomalies")
          .select("*", { count: "exact", head: true })
          .eq("audit_id", chunk.audit_id);

        const { data: allAnomalies } = await supabase
          .from("anomalies")
          .select("annual_impact")
          .eq("audit_id", chunk.audit_id);

        const annualRevenueAtRisk = allAnomalies?.reduce((sum, a) => sum + (a.annual_impact ?? 0), 0) ?? 0;

        await supabase
          .from("audits")
          .update({
            status: "review",
            chunks_completed: newCompleted,
            total_anomalies: anomalyCount ?? 0,
            annual_revenue_at_risk: annualRevenueAtRisk,
            processed_at: new Date().toISOString(),
            ai_insights: `Analysis completed. Processed ${audit.chunks_total} chunks. Found ${anomalyCount} potential revenue leaks totaling $${annualRevenueAtRisk.toFixed(2)} annually.`,
          })
          .eq("id", chunk.audit_id);

        console.log(`[process-chunk] Audit ${chunk.audit_id} completed! Total anomalies: ${anomalyCount}`);
      } else {
        // Update progress and trigger next chunk
        await supabase
          .from("audits")
          .update({ chunks_completed: newCompleted })
          .eq("id", chunk.audit_id);

        // Trigger next chunk processing
        const edgeFunctionUrl = `${supabaseUrl}/functions/v1/process-chunk`;
        fetch(edgeFunctionUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ trigger: "chain" }),
        }).catch((err) => console.error("[process-chunk] Failed to trigger next chunk:", err));
      }
    }

    return jsonResponse({
      success: true,
      chunk: chunk.chunk_index + 1,
      total: chunk.total_chunks,
      anomaliesFound: anomalies.length,
    });
  } catch (error) {
    console.error("[process-chunk] Error:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
