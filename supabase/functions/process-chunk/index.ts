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
  object: ["object", "type", "record_type"],
  disputed: ["disputed", "dispute", "is_disputed"],
};

// For usage/product logs
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
  if (!Number.isNaN(num) && num > 1000000000 && num < 1000000000000) {
    return new Date(num * 1000);
  }
  if (!Number.isNaN(num) && num >= 1000000000000) {
    return new Date(num);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

    console.log(`[process-chunk] File1 headers: ${JSON.stringify(file1Headers)}`);
    console.log(`[process-chunk] File2 headers: ${JSON.stringify(file2Headers)}`);
    console.log(`[process-chunk] File1 total rows: ${file1Result.data.length}`);
    console.log(`[process-chunk] File2 total rows: ${file2Result.data.length}`);

    // Get chunk slice - note: we get the FULL stripe data but only a slice of usage data
    // This is because we need to compare each usage chunk against ALL stripe records
    const file1Rows = file1Result.data.slice(chunk.file1_start_row, chunk.file1_end_row);
    const file2Rows = file2Result.data; // Full Stripe data for comparison

    console.log(`[process-chunk] Processing rows: file1[${chunk.file1_start_row}-${chunk.file1_end_row}] = ${file1Rows.length} rows, file2[all ${file2Rows.length}]`);

    // Determine file type: DB transaction logs vs Usage logs
    const isDbTransactionLog = findColumn(file1Headers, ["transaction_id", "txn_id", "net_amount", "fee_amount"]) !== null;
    console.log(`[process-chunk] File type detected: ${isDbTransactionLog ? "DB Transaction Log" : "Usage Log"}`);
    
    // Log first row of each file for debugging
    if (file1Rows.length > 0) {
      console.log(`[process-chunk] First file1 row sample: ${JSON.stringify(file1Rows[0])}`);
    }
    if (file2Rows.length > 0) {
      console.log(`[process-chunk] First file2 row sample: ${JSON.stringify(file2Rows[0])}`);
    }

    const anomalies: AnomalyInsert[] = [];
    const now = new Date().toISOString();
    const MAX_ANOMALIES_PER_CHUNK = 50;

    if (isDbTransactionLog) {
      // ============================================================================
      // DB TRANSACTION LOG PROCESSING
      // ============================================================================
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
      const dbByCustomerAmount = new Map<string, (typeof dbRows)[0][]>();
      for (const row of dbRows) {
        const key = `${row.customer_id}_${parseAmount(row.amount)}`;
        const existing = dbByCustomerAmount.get(key) ?? [];
        existing.push(row);
        dbByCustomerAmount.set(key, existing);
      }

      const FEE_DISCREPANCY_THRESHOLD_CENTS = 100;
      let anomalyCount = 0;

      // 1. DB transaction checks (unbilled usage, failed payments, disputed, fee discrepancies)
      for (const dbRow of dbRows) {
        if (anomalyCount >= MAX_ANOMALIES_PER_CHUNK) break;
        const customerId = dbRow.customer_id?.trim();
        const amount = parseAmount(dbRow.amount);
        if (!customerId || amount <= 0) continue;

        const key = `${customerId}_${amount}`;
        const stripeMatches = stripeByCustomerAmount.get(key) ?? [];
        const status = dbRow.status?.toLowerCase();

        if (status === "failed") {
          if (stripeMatches.length === 0) {
            anomalies.push({
              audit_id: chunk.audit_id,
              category: "failed_payment",
              customer_id: customerId,
              status: "detected",
              confidence: "high",
              annual_impact: (amount / 100) * 12,
              monthly_impact: amount / 100,
              description: `Failed payment of $${(amount / 100).toFixed(2)} for customer ${customerId} is recorded in DB but missing in Stripe.`,
              root_cause: "Failed payment attempts not recorded in Stripe export or sync issue.",
              recommendation: "Review failed payment sync and dunning workflow.",
              detected_at: now,
              metadata: { db_transaction_id: dbRow.transaction_id, amount },
            });
            anomalyCount++;
          }
          continue;
        }

        if (status === "disputed") {
          const stripeMatch = stripeMatches.find(
            (row) => row && String(row.disputed).toLowerCase() !== "true"
          );
          if (stripeMatch) {
            anomalies.push({
              audit_id: chunk.audit_id,
              category: "disputed_charge",
              customer_id: customerId,
              status: "detected",
              confidence: "medium",
              annual_impact: (amount / 100) * 12,
              monthly_impact: amount / 100,
              description: `Disputed charge for customer ${customerId} appears as disputed in DB but not in Stripe export.`,
              root_cause: "Status mismatch between internal records and Stripe export.",
              recommendation: "Verify dispute status in Stripe and reconcile dispute handling.",
              detected_at: now,
              metadata: { db_transaction_id: dbRow.transaction_id, amount, stripe_id: stripeMatch.id },
            });
            anomalyCount++;
          }
          continue;
        }

        if (status === "succeeded" || status === "paid" || status === "complete" || status === "completed") {
          if (stripeMatches.length === 0) {
            anomalies.push({
              audit_id: chunk.audit_id,
              category: "unbilled_usage",
              customer_id: customerId,
              status: "detected",
              confidence: "high",
              annual_impact: (amount / 100) * 12,
              monthly_impact: amount / 100,
              description: `DB transaction for ${customerId} ($${(amount / 100).toFixed(2)}) has no matching Stripe charge.`,
              root_cause: "Charge missing from Stripe export or billing not captured.",
              recommendation: "Verify Stripe charge creation and export sync.",
              detected_at: now,
              metadata: { db_transaction_id: dbRow.transaction_id, amount },
            });
            anomalyCount++;
          } else {
            const stripeMatch = stripeMatches[0];
            const dbFee = parseAmount(dbRow.fee_amount);
            const stripeFee = parseAmount(stripeMatch.fee);
            if (dbFee > 0 && stripeFee > 0 && Math.abs(dbFee - stripeFee) > FEE_DISCREPANCY_THRESHOLD_CENTS) {
              anomalies.push({
                audit_id: chunk.audit_id,
                category: "fee_discrepancy",
                customer_id: customerId,
                status: "detected",
                confidence: "low",
                annual_impact: Math.abs(dbFee - stripeFee) / 100,
                monthly_impact: Math.abs(dbFee - stripeFee) / 100,
                description: `Fee discrepancy for ${customerId}: DB fee $${(dbFee / 100).toFixed(2)} vs Stripe fee $${(stripeFee / 100).toFixed(2)}.`,
                root_cause: "Fee calculation mismatch between systems.",
                recommendation: "Reconcile fee calculation logic with Stripe fee formula.",
                detected_at: now,
                metadata: { db_fee: dbFee, stripe_fee: stripeFee, stripe_id: stripeMatch.id },
              });
              anomalyCount++;
            }
          }
        }
      }

      // 2. Stripe-only checks (run once on last chunk to avoid duplicates)
      if (chunk.chunk_index === chunk.total_chunks - 1) {
        // Zombie subscriptions: Stripe charge with no matching DB transaction
        for (const stripeRow of stripeRows) {
          if (anomalyCount >= MAX_ANOMALIES_PER_CHUNK) break;
          const status = stripeRow.status?.toLowerCase();
          if (!status || !["succeeded", "paid", "complete", "completed"].includes(status)) continue;
          const customerId = stripeRow.customer?.trim();
          const amount = parseAmount(stripeRow.amount);
          if (!customerId || amount <= 0) continue;
          const key = `${customerId}_${amount}`;
          if (dbByCustomerAmount.has(key)) continue;

          anomalies.push({
            audit_id: chunk.audit_id,
            category: "zombie_subscription",
            customer_id: customerId,
            status: "detected",
            confidence: "medium",
            annual_impact: (amount / 100) * 12,
            monthly_impact: amount / 100,
            description: `Stripe charge for ${customerId} ($${(amount / 100).toFixed(2)}) has no matching DB transaction.`,
            root_cause: "Stripe charge exists without corresponding internal record.",
            recommendation: "Verify internal billing ingestion pipeline.",
            detected_at: now,
            metadata: { stripe_id: stripeRow.id, amount },
          });
          anomalyCount++;
        }

        // Duplicate charges in Stripe (same customer, amount, and day)
        const stripeDuplicates = new Map<string, (typeof stripeRows)[0][]>();
        for (const stripeRow of stripeRows) {
          const status = stripeRow.status?.toLowerCase();
          if (!status || !["succeeded", "paid", "complete", "completed"].includes(status)) continue;
          const customerId = stripeRow.customer?.trim();
          const amount = parseAmount(stripeRow.amount);
          const date = parseDate(stripeRow.created);
          if (!customerId || amount <= 0 || !date) continue;
          const day = date.toISOString().split("T")[0];
          const key = `${customerId}_${amount}_${day}`;
          const existing = stripeDuplicates.get(key) ?? [];
          existing.push(stripeRow);
          stripeDuplicates.set(key, existing);
        }
        for (const [key, rows] of stripeDuplicates) {
          if (anomalyCount >= MAX_ANOMALIES_PER_CHUNK) break;
          if (rows.length < 2) continue;
          const amount = parseAmount(rows[0].amount);
          const customerId = rows[0].customer || "unknown";
          anomalies.push({
            audit_id: chunk.audit_id,
            category: "duplicate_charge",
            customer_id: customerId,
            status: "detected",
            confidence: "high",
            annual_impact: (amount / 100) * 12,
            monthly_impact: amount / 100,
            description: `Duplicate charges detected for ${customerId} (${rows.length} charges on the same day).`,
            root_cause: "Multiple identical charges for same customer, amount, and day.",
            recommendation: "Investigate duplicate billing or idempotency issues.",
            detected_at: now,
            metadata: { stripe_ids: rows.map((r) => r.id).slice(0, 5), key },
          });
          anomalyCount++;
        }
      }
    } else {
      // ============================================================================
      // USAGE LOG PROCESSING
      // ============================================================================
      console.log("[process-chunk] Processing as Usage Logs");

      const usageMapping: Record<string, string | null> = {};
      for (const [key, hints] of Object.entries(USAGE_COLUMN_HINTS)) {
        usageMapping[key] = findColumn(file1Headers, hints);
      }

      const stripeMapping: Record<string, string | null> = {};
      for (const [key, hints] of Object.entries(STRIPE_COLUMN_HINTS)) {
        stripeMapping[key] = findColumn(file2Headers, hints);
      }

      console.log("[process-chunk] Usage mapping:", JSON.stringify(usageMapping));
      console.log("[process-chunk] Stripe mapping:", JSON.stringify(stripeMapping));

      const usageRows = file1Rows.map((row) => mapRow(row as Record<string, string>, usageMapping));
      const stripeRows = file2Rows.map((row) => mapRow(row as Record<string, string>, stripeMapping));

      // Group by customer
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

      console.log(`[process-chunk] Found ${usageByCustomer.size} unique customers in usage chunk, ${stripeByCustomer.size} in Stripe`);
      console.log(`[process-chunk] Usage customers sample: ${[...usageByCustomer.keys()].slice(0, 5).join(", ")}`);
      console.log(`[process-chunk] Stripe customers sample: ${[...stripeByCustomer.keys()].slice(0, 5).join(", ")}`);

      // Get all unique customer IDs from this chunk's usage data
      const chunkCustomerIds = [...usageByCustomer.keys()];
      console.log(`[process-chunk] Processing ${chunkCustomerIds.length} customers from usage chunk`);

      for (const customerId of chunkCustomerIds) {
        if (anomalies.length >= MAX_ANOMALIES_PER_CHUNK) break;

        const usageEvents = usageByCustomer.get(customerId) ?? [];
        const stripeCharges = stripeByCustomer.get(customerId) ?? [];

        // Log the statuses we see for debugging
        const uniqueStatuses = [...new Set(stripeCharges.map(c => c.status?.toLowerCase()))];
        if (stripeCharges.length > 0 && customerId === chunkCustomerIds[0]) {
          console.log(`[process-chunk] Stripe statuses seen: ${uniqueStatuses.join(", ")}`);
        }

        const succeededCharges = stripeCharges.filter((c) => {
          const status = c.status?.toLowerCase();
          return status === "succeeded" || status === "paid" || status === "complete" || status === "completed";
        });
        const failedCharges = stripeCharges.filter((c) => {
          const status = c.status?.toLowerCase();
          return status === "failed" || status === "failure" || status === "declined";
        });
        const refundedCharges = stripeCharges.filter((c) => {
          const status = c.status?.toLowerCase();
          return status === "refunded" || Number(c.amount_refunded) > 0;
        });

        const totalUsage = usageEvents.reduce((sum, e) => sum + (Number(e.quantity) || 0), 0);
        const totalCharged = succeededCharges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0) / 100;
        const totalFailed = failedCharges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0) / 100;
        const totalRefunded = refundedCharges.reduce((sum, c) => sum + (Number(c.amount_refunded || c.amount) || 0), 0) / 100;

        // Zombie subscription: Customer paying but no usage
        if (succeededCharges.length > 0 && usageEvents.length === 0) {
          anomalies.push({
            audit_id: chunk.audit_id,
            category: "zombie_subscription",
            customer_id: customerId,
            status: "detected",
            confidence: succeededCharges.length >= 3 ? "high" : succeededCharges.length >= 2 ? "medium" : "low",
            annual_impact: totalCharged * 12,
            monthly_impact: totalCharged,
            description: `Customer ${customerId} has ${succeededCharges.length} successful charge(s) totaling $${totalCharged.toFixed(2)} but zero usage events in this period.`,
            root_cause: "Customer may have churned or suspended usage while billing continues.",
            recommendation: "Contact customer to verify continued usage. Consider pausing subscription.",
            detected_at: now,
            metadata: { charges: succeededCharges.length, total: totalCharged },
          });
        }

        // Unbilled usage: Customer using but not paying
        if (usageEvents.length > 0 && succeededCharges.length === 0) {
          const estimatedRevenue = totalUsage * 0.05; // Estimated value per unit
          anomalies.push({
            audit_id: chunk.audit_id,
            category: "unbilled_usage",
            customer_id: customerId,
            status: "detected",
            confidence: usageEvents.length >= 5 ? "high" : usageEvents.length >= 2 ? "medium" : "low",
            annual_impact: estimatedRevenue * 12,
            monthly_impact: estimatedRevenue,
            description: `Customer ${customerId} has ${usageEvents.length} usage event(s) (${totalUsage} units) but no successful payments.`,
            root_cause: "Billing configuration issue, missing payment method, or free trial not converted.",
            recommendation: "Review billing setup. Implement conversion campaign for trial users.",
            detected_at: now,
            metadata: { events: usageEvents.length, units: totalUsage },
          });
        }

        // Failed payments
        if (failedCharges.length > 0) {
          anomalies.push({
            audit_id: chunk.audit_id,
            category: "failed_payment",
            customer_id: customerId,
            status: "detected",
            confidence: "high",
            annual_impact: totalFailed * 12,
            monthly_impact: totalFailed,
            description: `Customer ${customerId} has ${failedCharges.length} failed payment(s) totaling $${totalFailed.toFixed(2)}.`,
            root_cause: "Payment method declined, insufficient funds, or expired card.",
            recommendation: "Implement dunning sequence. Contact customer to update payment method.",
            detected_at: now,
            metadata: { failedCount: failedCharges.length, totalFailed },
          });
        }

        // High refund rate
        if (totalRefunded > 0 && totalCharged > 0 && totalRefunded / totalCharged > 0.1) {
          anomalies.push({
            audit_id: chunk.audit_id,
            category: "high_refund_rate",
            customer_id: customerId,
            status: "detected",
            confidence: "medium",
            annual_impact: totalRefunded * 12,
            monthly_impact: totalRefunded,
            description: `Customer ${customerId} has a ${((totalRefunded / totalCharged) * 100).toFixed(0)}% refund rate ($${totalRefunded.toFixed(2)} of $${totalCharged.toFixed(2)}).`,
            root_cause: "Product/service issues, billing disputes, or customer dissatisfaction.",
            recommendation: "Review customer satisfaction. Investigate root cause of refunds.",
            detected_at: now,
            metadata: { refundRate: totalRefunded / totalCharged, totalRefunded, totalCharged },
          });
        }
      }

      // For zombie detection (Stripe customers with no usage), we need to check
      // against ALL usage data, not just this chunk. We'll do this on the LAST chunk.
      if (chunk.chunk_index === chunk.total_chunks - 1) {
        console.log(`[process-chunk] Last chunk - running zombie subscription detection`);
        
        // Re-parse full file1 to get ALL usage customers
        const allUsageRows = file1Result.data;
        const allUsageCustomers = new Set<string>();
        for (const row of allUsageRows) {
          const mapped = mapRow(row as Record<string, string>, usageMapping);
          const custId = mapped.customer_id?.trim();
          if (custId) allUsageCustomers.add(custId);
        }
        
        console.log(`[process-chunk] Total unique usage customers: ${allUsageCustomers.size}`);
        
        for (const [customerId, stripeCharges] of stripeByCustomer) {
          if (anomalies.length >= MAX_ANOMALIES_PER_CHUNK) break;
          if (allUsageCustomers.has(customerId)) continue; // Has usage, skip

          const succeededCharges = stripeCharges.filter((c) => {
            const status = c.status?.toLowerCase();
            return status === "succeeded" || status === "paid" || status === "complete" || status === "completed";
          });
          
          if (succeededCharges.length > 0) {
            const totalCharged = succeededCharges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0) / 100;
            anomalies.push({
              audit_id: chunk.audit_id,
              category: "zombie_subscription",
              customer_id: customerId,
              status: "detected",
              confidence: succeededCharges.length >= 3 ? "high" : "medium",
              annual_impact: totalCharged * 12,
              monthly_impact: totalCharged,
              description: `Customer ${customerId} has ${succeededCharges.length} charge(s) totaling $${totalCharged.toFixed(2)} but NO usage events at all.`,
              root_cause: "Customer is paying but has completely stopped using the service.",
              recommendation: "Reach out to customer. High churn risk.",
              detected_at: now,
              metadata: { charges: succeededCharges.length, total: totalCharged, source: "stripe_only" },
            });
          }
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
        let periodStart: string | null = null;
        let periodEnd: string | null = null;
        const allTimestamps: number[] = [];

        for (const row of file1Result.data) {
          const dateFields = ["created_at", "timestamp", "date", "created"];
          for (const field of dateFields) {
            const value = (row as Record<string, string>)[field];
            if (value) {
              const date = parseDate(String(value));
              if (date) allTimestamps.push(date.getTime());
            }
          }
        }
        for (const row of file2Result.data) {
          const dateFields = ["created", "date", "timestamp"];
          for (const field of dateFields) {
            const value = (row as Record<string, string>)[field];
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
            audit_period_start: periodStart,
            audit_period_end: periodEnd,
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
