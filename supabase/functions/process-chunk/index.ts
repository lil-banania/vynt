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
  customer_name: ["customer_name", "name", "full_name"],
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
  customer_name: ["customer_name", "name", "customer_description"],
  amount_refunded: ["amount_refunded", "refunded", "refund_amount"],
  invoice: ["invoice", "invoice_id", "inv_id"],
  object: ["object", "type", "record_type"],
  disputed: ["disputed", "dispute", "is_disputed"],
};

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
  if (!isNaN(num) && num > 1000000000 && num < 10000000000) {
    return new Date(num * 1000);
  }
  if (!isNaN(num) && num > 1000000000000) {
    return new Date(num);
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
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

    // Get chunk slice
    const file1Rows = file1Result.data.slice(chunk.file1_start_row, chunk.file1_end_row);
    const file2Rows = file2Result.data; // Full Stripe data for comparison

    console.log(`[process-chunk] Processing rows: file1[${chunk.file1_start_row}-${chunk.file1_end_row}] = ${file1Rows.length} rows, file2[all ${file2Rows.length}]`);

    // Determine file type: DB transaction logs vs Usage logs
    const isDbTransactionLog = findColumn(file1Headers, ["transaction_id", "txn_id", "net_amount", "fee_amount"]) !== null;
    console.log(`[process-chunk] File type detected: ${isDbTransactionLog ? "DB Transaction Log" : "Usage Log"}`);

    const anomalies: AnomalyInsert[] = [];
    const now = new Date().toISOString();

    // Per-category caps to ensure balanced detection
    const CAPS = {
      unbilled_usage: 30,
      failed_payment: 30,
      disputed_charge: 30,
      fee_discrepancy: 30,
      zombie_subscription: 30,
      duplicate_charge: 30,
    };
    const counts = {
      unbilled_usage: 0,
      failed_payment: 0,
      disputed_charge: 0,
      fee_discrepancy: 0,
      zombie_subscription: 0,
      duplicate_charge: 0,
    };

    if (isDbTransactionLog) {
      // ============================================================================
      // DB TRANSACTION LOG PROCESSING
      // Key insight: Match by AMOUNT + DATE (within 1 day), not by customer ID
      // This handles test data where customer IDs don't match between systems
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

      // Build lookup by amount + date (YYYY-MM-DD)
      const stripeByAmountDate = new Map<string, { row: (typeof stripeRows)[0]; used: boolean }[]>();
      for (const row of stripeRows) {
        const amount = parseAmount(row.amount);
        const date = parseDate(row.created);
        if (amount <= 0 || !date) continue;
        const dateStr = date.toISOString().split("T")[0];
        const key = `${amount}_${dateStr}`;
        const existing = stripeByAmountDate.get(key) ?? [];
        existing.push({ row, used: false });
        stripeByAmountDate.set(key, existing);
      }

      // Also build lookup by amount only for looser matching
      const stripeByAmount = new Map<string, { row: (typeof stripeRows)[0]; used: boolean }[]>();
      for (const row of stripeRows) {
        const amount = parseAmount(row.amount);
        if (amount <= 0) continue;
        const key = `${amount}`;
        const existing = stripeByAmount.get(key) ?? [];
        existing.push({ row, used: false });
        stripeByAmount.set(key, existing);
      }

      const FEE_DISCREPANCY_THRESHOLD_CENTS = 100;

      // Track which DB transactions have been matched
      const matchedDbTxns = new Set<string>();
      const matchedStripeTxns = new Set<string>();

      // Process DB transactions
      for (const dbRow of dbRows) {
        const customerId = dbRow.customer_id?.trim() || "unknown";
        const amount = parseAmount(dbRow.amount);
        const status = dbRow.status?.toLowerCase();
        const dbDate = parseDate(dbRow.created_at);
        const txnId = dbRow.transaction_id || `${customerId}_${amount}`;

        if (amount <= 0) continue;

        // Try to find matching Stripe transaction by amount + date
        const dateStr = dbDate ? dbDate.toISOString().split("T")[0] : null;
        let stripeMatch: (typeof stripeRows)[0] | null = null;

        // First try exact date match
        if (dateStr) {
          const key = `${amount}_${dateStr}`;
          const candidates = stripeByAmountDate.get(key);
          if (candidates) {
            for (const candidate of candidates) {
              if (!candidate.used) {
                stripeMatch = candidate.row;
                candidate.used = true;
                matchedStripeTxns.add(stripeMatch.id || `${stripeMatch.customer}_${amount}`);
                break;
              }
            }
          }
        }

        // If no exact date match, try ±1 day
        if (!stripeMatch && dateStr) {
          const dbDateObj = new Date(dateStr);
          for (const offset of [-1, 1]) {
            const altDate = new Date(dbDateObj);
            altDate.setDate(altDate.getDate() + offset);
            const altDateStr = altDate.toISOString().split("T")[0];
            const key = `${amount}_${altDateStr}`;
            const candidates = stripeByAmountDate.get(key);
            if (candidates) {
              for (const candidate of candidates) {
                if (!candidate.used) {
                  stripeMatch = candidate.row;
                  candidate.used = true;
                  matchedStripeTxns.add(stripeMatch.id || `${stripeMatch.customer}_${amount}`);
                  break;
                }
              }
            }
            if (stripeMatch) break;
          }
        }

        matchedDbTxns.add(txnId);

        // Detect anomalies based on status and match
        if (status === "failed") {
          if (!stripeMatch && counts.failed_payment < CAPS.failed_payment) {
            anomalies.push({
              audit_id: chunk.audit_id,
              category: "failed_payment",
              customer_id: customerId,
              status: "detected",
              confidence: "high",
              annual_impact: (amount / 100) * 12,
              monthly_impact: amount / 100,
              description: `Failed payment of $${(amount / 100).toFixed(2)} for customer ${customerId} not found in Stripe.`,
              root_cause: "Failed payment not recorded in Stripe or sync issue.",
              recommendation: "Review dunning workflow and payment retry logic.",
              detected_at: now,
              metadata: { db_transaction_id: dbRow.transaction_id, amount },
            });
            counts.failed_payment++;
          }
        } else if (status === "disputed") {
          if (stripeMatch && String(stripeMatch.disputed).toLowerCase() !== "true") {
            if (counts.disputed_charge < CAPS.disputed_charge) {
              anomalies.push({
                audit_id: chunk.audit_id,
                category: "disputed_charge",
                customer_id: customerId,
                status: "detected",
                confidence: "medium",
                annual_impact: (amount / 100) * 12,
                monthly_impact: amount / 100,
                description: `Disputed charge for ${customerId} ($${(amount / 100).toFixed(2)}) - DB shows disputed but Stripe does not.`,
                root_cause: "Status mismatch between systems.",
                recommendation: "Reconcile dispute status with Stripe.",
                detected_at: now,
                metadata: { db_transaction_id: dbRow.transaction_id, stripe_id: stripeMatch.id, amount },
              });
              counts.disputed_charge++;
            }
          }
        } else if (status === "succeeded" || status === "paid" || status === "complete") {
          if (!stripeMatch) {
            // Unbilled usage - DB succeeded but no Stripe charge
            if (counts.unbilled_usage < CAPS.unbilled_usage) {
              anomalies.push({
                audit_id: chunk.audit_id,
                category: "unbilled_usage",
                customer_id: customerId,
                status: "detected",
                confidence: "high",
                annual_impact: (amount / 100) * 12,
                monthly_impact: amount / 100,
                description: `Transaction of $${(amount / 100).toFixed(2)} for ${customerId} exists in DB but not in Stripe.`,
                root_cause: "Charge missing from Stripe or not captured.",
                recommendation: "Verify charge creation in Stripe.",
                detected_at: now,
                metadata: { db_transaction_id: dbRow.transaction_id, amount },
              });
              counts.unbilled_usage++;
            }
          } else {
            // Check for fee discrepancy
            const dbFee = parseAmount(dbRow.fee_amount);
            const stripeFee = parseAmount(stripeMatch.fee);
            if (dbFee > 0 && stripeFee > 0 && Math.abs(dbFee - stripeFee) > FEE_DISCREPANCY_THRESHOLD_CENTS) {
              if (counts.fee_discrepancy < CAPS.fee_discrepancy) {
                anomalies.push({
                  audit_id: chunk.audit_id,
                  category: "fee_discrepancy",
                  customer_id: customerId,
                  status: "detected",
                  confidence: "low",
                  annual_impact: Math.abs(dbFee - stripeFee) / 100,
                  monthly_impact: Math.abs(dbFee - stripeFee) / 100,
                  description: `Fee mismatch for ${customerId}: DB $${(dbFee / 100).toFixed(2)} vs Stripe $${(stripeFee / 100).toFixed(2)}.`,
                  root_cause: "Fee calculation differs between systems.",
                  recommendation: "Reconcile fee calculation logic.",
                  detected_at: now,
                  metadata: { db_fee: dbFee, stripe_fee: stripeFee, stripe_id: stripeMatch.id },
                });
                counts.fee_discrepancy++;
              }
            }
          }
        }
      }

      // On last chunk: Check for Stripe transactions with no DB match (zombies) and duplicates
      if (chunk.chunk_index === chunk.total_chunks - 1) {
        console.log(`[process-chunk] Last chunk - checking zombies and duplicates`);

        // Build set of all DB amounts+dates from full file
        const allDbAmountDates = new Set<string>();
        const allDbAmounts = new Map<string, number>();
        for (const row of file1Result.data) {
          const mapped = mapRow(row as Record<string, string>, dbMapping);
          const amount = parseAmount(mapped.amount);
          const date = parseDate(mapped.created_at);
          if (amount <= 0) continue;
          if (date) {
            const dateStr = date.toISOString().split("T")[0];
            allDbAmountDates.add(`${amount}_${dateStr}`);
            // Also add ±1 day variants
            for (const offset of [-1, 1]) {
              const altDate = new Date(date);
              altDate.setDate(altDate.getDate() + offset);
              allDbAmountDates.add(`${amount}_${altDate.toISOString().split("T")[0]}`);
            }
          }
          allDbAmounts.set(`${amount}`, (allDbAmounts.get(`${amount}`) ?? 0) + 1);
        }

        // Zombie subscriptions: Stripe charge with no matching DB transaction
        for (const stripeRow of stripeRows) {
          if (counts.zombie_subscription >= CAPS.zombie_subscription) break;
          const status = stripeRow.status?.toLowerCase();
          if (!status || !["succeeded", "paid", "complete"].includes(status)) continue;

          const amount = parseAmount(stripeRow.amount);
          const date = parseDate(stripeRow.created);
          if (amount <= 0 || !date) continue;

          const dateStr = date.toISOString().split("T")[0];
          const key = `${amount}_${dateStr}`;

          // Check if there's a DB transaction with same amount within ±1 day
          if (!allDbAmountDates.has(key)) {
            const customerId = stripeRow.customer || "unknown";
            anomalies.push({
              audit_id: chunk.audit_id,
              category: "zombie_subscription",
              customer_id: customerId,
              status: "detected",
              confidence: "medium",
              annual_impact: (amount / 100) * 12,
              monthly_impact: amount / 100,
              description: `Stripe charge of $${(amount / 100).toFixed(2)} has no matching DB transaction.`,
              root_cause: "Charge exists in Stripe without internal record.",
              recommendation: "Verify billing ingestion pipeline.",
              detected_at: now,
              metadata: { stripe_id: stripeRow.id, amount },
            });
            counts.zombie_subscription++;
          }
        }

        // Duplicate charges: Multiple Stripe charges with same amount on same day
        const stripeDuplicates = new Map<string, (typeof stripeRows)[0][]>();
        for (const stripeRow of stripeRows) {
          const status = stripeRow.status?.toLowerCase();
          if (!status || !["succeeded", "paid", "complete"].includes(status)) continue;

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

        for (const [_, rows] of stripeDuplicates) {
          if (counts.duplicate_charge >= CAPS.duplicate_charge) break;
          if (rows.length < 2) continue;

          const amount = parseAmount(rows[0].amount);
          const customerId = rows[0].customer || "unknown";
          anomalies.push({
            audit_id: chunk.audit_id,
            category: "duplicate_charge",
            customer_id: customerId,
            status: "detected",
            confidence: "high",
            annual_impact: (amount / 100) * (rows.length - 1) * 12,
            monthly_impact: (amount / 100) * (rows.length - 1),
            description: `${rows.length} duplicate charges of $${(amount / 100).toFixed(2)} for ${customerId} on the same day.`,
            root_cause: "Multiple identical charges detected.",
            recommendation: "Investigate duplicate billing or idempotency issues.",
            detected_at: now,
            metadata: { charge_ids: rows.map((r) => r.id), count: rows.length, amount },
          });
          counts.duplicate_charge++;
        }
      }
    } else {
      // ============================================================================
      // USAGE LOG PROCESSING (unchanged from before)
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

      console.log(`[process-chunk] Found ${usageByCustomer.size} customers in usage, ${stripeByCustomer.size} in Stripe`);

      for (const customerId of usageByCustomer.keys()) {
        if (anomalies.length >= 100) break;
        const usageEvents = usageByCustomer.get(customerId) ?? [];
        const stripeCharges = stripeByCustomer.get(customerId) ?? [];

        const succeededCharges = stripeCharges.filter((c) =>
          ["succeeded", "paid", "complete"].includes(c.status?.toLowerCase() ?? "")
        );

        if (usageEvents.length > 0 && succeededCharges.length === 0) {
          anomalies.push({
            audit_id: chunk.audit_id,
            category: "unbilled_usage",
            customer_id: customerId,
            status: "detected",
            confidence: "medium",
            annual_impact: usageEvents.length * 10,
            monthly_impact: usageEvents.length * 10 / 12,
            description: `Customer ${customerId} has ${usageEvents.length} usage events but no payments.`,
            root_cause: "Billing not configured or free tier.",
            recommendation: "Review billing configuration.",
            detected_at: now,
            metadata: { events: usageEvents.length },
          });
        }
      }
    }

    console.log(`[process-chunk] Detected ${anomalies.length} anomalies in chunk ${chunk.chunk_index + 1}`);
    console.log(`[process-chunk] Category counts: ${JSON.stringify(counts)}`);

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
            ai_insights: `Analysis completed. Found ${anomalyCount ?? 0} potential revenue issues totaling $${annualRevenueAtRisk.toFixed(2)} annually at risk.`,
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
      counts,
    });
  } catch (error) {
    console.error("[process-chunk] Error:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
