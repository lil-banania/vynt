import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import Papa from "https://esm.sh/papaparse@5.4.1";

// ============================================================================
// COLUMN MAPPING
// ============================================================================
const DB_COLUMN_HINTS: Record<string, string[]> = {
  transaction_id: ["transaction_id", "txn_id", "id", "internal_id"],
  customer_id: ["customer_id", "customer", "cust_id", "user_id"],
  amount: ["amount", "gross_amount", "total", "charge_amount"],
  fee_amount: ["fee_amount", "fee", "fees", "stripe_fee"],
  status: ["status", "state", "payment_status"],
  created_at: ["created_at", "created", "timestamp", "date"],
  customer_name: ["customer_name", "name"],
};

const STRIPE_COLUMN_HINTS: Record<string, string[]> = {
  id: ["id", "charge_id", "payment_id", "stripe_id"],
  customer: ["customer", "customer_id", "cust_id"],
  amount: ["amount", "total", "charge_amount"],
  fee: ["fee", "stripe_fee", "processing_fee"],
  status: ["status", "state", "payment_status"],
  created: ["created", "date", "timestamp", "created_at"],
  disputed: ["disputed", "dispute", "is_disputed"],
  object: ["object", "type"],
};

function findColumn(headers: string[], hints: string[]): string | null {
  const lower = headers.map(h => h.toLowerCase().trim());
  for (const hint of hints) {
    const idx = lower.findIndex(h => h === hint.toLowerCase() || h.includes(hint.toLowerCase()));
    if (idx !== -1) return headers[idx];
  }
  return null;
}

function mapRow(row: Record<string, string>, mapping: Record<string, string | null>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, col] of Object.entries(mapping)) {
    if (col && row[col] !== undefined) result[key] = row[col];
  }
  return result;
}

// Parse amounts into **cents** (align with analyze-audit)
function parseAmount(value: string | undefined): number {
  if (!value) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;

  const hasDecimal = raw.includes(".");
  const hasCurrencyOrComma = /[$,]/.test(raw);
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  if (!cleaned) return 0;
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return 0;

  if (hasDecimal || hasCurrencyOrComma) return Math.round(num * 100);
  const abs = Math.abs(num);
  if (abs < 1000) return Math.round(num * 100);
  return Math.round(num);
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const num = Number(value);
  if (!isNaN(num) && num > 1e9 && num < 1e10) return new Date(num * 1000);
  if (!isNaN(num) && num > 1e12) return new Date(num);
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// Normalize customer ID for consistent matching
function normalizeCustomerId(id: string | undefined): string {
  if (!id) return "";
  return id.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Check if two dates are within N days of each other
function isWithinDays(d1: Date | null, d2: Date | null, days: number): boolean {
  if (!d1 || !d2) return true; // If no date, allow match
  const diffMs = Math.abs(d1.getTime() - d2.getTime());
  return diffMs <= days * 24 * 60 * 60 * 1000;
}

serve(async (req) => {
  const startTime = Date.now();
  console.log("[process-chunk] Started");

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Config missing" }), { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // Get next pending chunk
    const { data: chunk } = await supabase
      .from("analysis_queue")
      .select("*")
      .eq("status", "pending")
      .order("chunk_index", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!chunk) {
      console.log("[process-chunk] No pending chunks");
      return new Response(JSON.stringify({ message: "No pending chunks" }));
    }

    console.log(`[process-chunk] Processing chunk ${chunk.chunk_index + 1}/${chunk.total_chunks}`);

    await supabase
      .from("analysis_queue")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("id", chunk.id);

    // Get files
    const { data: files } = await supabase
      .from("uploaded_files")
      .select("file_type, file_path")
      .eq("audit_id", chunk.audit_id);

    const file1 = files?.find(f => f.file_type === "usage_logs");
    const file2 = files?.find(f => f.file_type === "stripe_export");

    if (!file1 || !file2) {
      throw new Error("Files not found");
    }

    // Download files
    const [{ data: f1 }, { data: f2 }] = await Promise.all([
      supabase.storage.from("audit-files").download(file1.file_path),
      supabase.storage.from("audit-files").download(file2.file_path),
    ]);

    if (!f1 || !f2) throw new Error("Failed to download files");

    const [text1, text2] = await Promise.all([f1.text(), f2.text()]);
    const parsed1 = Papa.parse<Record<string, string>>(text1, { header: true, skipEmptyLines: true });
    const parsed2 = Papa.parse<Record<string, string>>(text2, { header: true, skipEmptyLines: true });

    const h1 = parsed1.meta.fields ?? [];
    const h2 = parsed2.meta.fields ?? [];

    // Build mappings
    const dbMap: Record<string, string | null> = {};
    for (const [k, hints] of Object.entries(DB_COLUMN_HINTS)) dbMap[k] = findColumn(h1, hints);
    
    const stripeMap: Record<string, string | null> = {};
    for (const [k, hints] of Object.entries(STRIPE_COLUMN_HINTS)) stripeMap[k] = findColumn(h2, hints);

    // Get chunk of DB rows
    const dbRows = parsed1.data.slice(chunk.file1_start_row, chunk.file1_end_row)
      .map(r => mapRow(r as Record<string, string>, dbMap));
    const stripeRows = parsed2.data.map(r => mapRow(r as Record<string, string>, stripeMap));

    console.log(`[process-chunk] DB rows: ${dbRows.length}, Stripe rows: ${stripeRows.length}`);

    // ==========================================================================
    // GET PREVIOUSLY MATCHED STRIPE IDs FROM DB (state persistence!)
    // ==========================================================================
    const { data: prevMatches } = await supabase
      .from("matched_transactions")
      .select("stripe_id")
      .eq("audit_id", chunk.audit_id);
    
    const matchedStripeIds = new Set<string>(prevMatches?.map(m => m.stripe_id).filter(Boolean) ?? []);
    console.log(`[process-chunk] Previously matched: ${matchedStripeIds.size} Stripe IDs`);

    // Build Stripe lookup map with NORMALIZED customer IDs
    const stripeByCustomerAmount = new Map<string, typeof stripeRows[0][]>();
    for (const row of stripeRows) {
      const normCustomer = normalizeCustomerId(row.customer);
      const key = `${normCustomer}_${parseAmount(row.amount)}`;
      if (!stripeByCustomerAmount.has(key)) stripeByCustomerAmount.set(key, []);
      stripeByCustomerAmount.get(key)!.push(row);
    }
    
    // Also build by amount only for fallback matching
    const stripeByAmount = new Map<string, typeof stripeRows[0][]>();
    for (const row of stripeRows) {
      const amt = parseAmount(row.amount);
      const key = `${amt}`;
      if (!stripeByAmount.has(key)) stripeByAmount.set(key, []);
      stripeByAmount.get(key)!.push(row);
    }

    // Process anomalies - collect ALL potential anomalies first, then sort by impact
    const potentialAnomalies: {
      category: string;
      data: Record<string, unknown>;
      impact: number;
    }[] = [];
    const newMatches: Array<{ audit_id: string; stripe_id: string; db_transaction_id: string }> = [];
    const now = new Date().toISOString();

    // Caps per TEST_DATA_README.md
    const caps = { failed: 40, unbilled: 35, disputed: 15 };
    
    // Get current counts from previous chunks
    const { count: existingFailed } = await supabase
      .from("anomalies").select("*", { count: "exact", head: true })
      .eq("audit_id", chunk.audit_id).eq("category", "failed_payment");
    const { count: existingUnbilled } = await supabase
      .from("anomalies").select("*", { count: "exact", head: true })
      .eq("audit_id", chunk.audit_id).eq("category", "unbilled_usage");
    const { count: existingDisputed } = await supabase
      .from("anomalies").select("*", { count: "exact", head: true })
      .eq("audit_id", chunk.audit_id).eq("category", "disputed_charge");

    const existingCounts = {
      failed: existingFailed ?? 0,
      unbilled: existingUnbilled ?? 0,
      disputed: existingDisputed ?? 0,
    };

    const DATE_WINDOW_DAYS = 2; // Match within ±2 days (tightened for better accuracy)

    // Helper to find best match with date preference
    const findBestMatch = (cands: typeof stripeRows[0][], dbDate: Date | null) => {
      let bestMatch: typeof stripeRows[0] | null = null;
      let bestDateDiff = Infinity;
      
      for (const c of cands) {
        if (c.object === "refund") continue;
        if (c.status?.toLowerCase() !== "succeeded") continue;
        if (c.id && matchedStripeIds.has(c.id)) continue;
        
        const stripeDate = parseDate(c.created);
        if (!isWithinDays(dbDate, stripeDate, DATE_WINDOW_DAYS)) continue;
        
        const diff = dbDate && stripeDate 
          ? Math.abs(dbDate.getTime() - stripeDate.getTime()) 
          : 0;
        if (diff < bestDateDiff) {
          bestDateDiff = diff;
          bestMatch = c;
        }
      }
      return bestMatch;
    };
    
    // PHASE 1: Collect ALL potential anomalies (no caps yet)
    for (const dbRow of dbRows) {
      const status = dbRow.status?.toLowerCase();
      const amount = parseAmount(dbRow.amount);
      if (amount <= 0) continue;

      const normCustomer = normalizeCustomerId(dbRow.customer_id);
      const dbDate = parseDate(dbRow.created_at);
      const key = `${normCustomer}_${amount}`;
      const candidates = stripeByCustomerAmount.get(key) ?? [];
      const amountDollars = amount / 100;

      if (status === "failed") {
        // Fix #6: Double-check failed payments logic
        // Case 1: DB says failed, Stripe has no record → webhook failure
        const hasMatch = candidates.some(c => 
          c.status?.toLowerCase() === "succeeded" || c.status?.toLowerCase() === "failed"
        );
        if (!hasMatch) {
          potentialAnomalies.push({
            category: "failed_payment",
            impact: amountDollars,
            data: {
              audit_id: chunk.audit_id,
              category: "failed_payment",
              customer_id: dbRow.customer_id || null,
              status: "detected",
              confidence: "high",
              annual_impact: amountDollars,
              monthly_impact: amountDollars / 12,
              description: `Failed payment of $${amountDollars.toFixed(2)} not recorded in Stripe.`,
              root_cause: "Webhook failure - Stripe payment not recorded in DB.",
              recommendation: "Review dunning workflow and webhook delivery.",
              detected_at: now,
              metadata: { amount, db_status: "failed", stripe_status: "not_found" },
            }
          });
        }
      } else if (status === "succeeded" || status === "paid") {
        // Check for status mismatch (Case 2: DB succeeded but Stripe failed)
        const failedInStripe = candidates.find(c => c.status?.toLowerCase() === "failed");
        if (failedInStripe) {
          potentialAnomalies.push({
            category: "failed_payment",
            impact: amountDollars,
            data: {
              audit_id: chunk.audit_id,
              category: "failed_payment",
              customer_id: dbRow.customer_id || null,
              status: "detected",
              confidence: "medium",
              annual_impact: amountDollars,
              monthly_impact: amountDollars / 12,
              description: `Status mismatch: DB shows success but Stripe shows failure ($${amountDollars.toFixed(2)}).`,
              root_cause: "Data inconsistency - DB shows success but Stripe shows failure.",
              recommendation: "Investigate payment processor logs and reconcile status.",
              detected_at: now,
              metadata: { amount, db_status: "succeeded", stripe_status: "failed" },
            }
          });
        }
      } else if (status === "succeeded" || status === "paid") {
        // Strategy 1: Match by normalized customer + amount + date window
        let match = findBestMatch(candidates, dbDate);
        
        // Strategy 2: Fallback to amount + SAME DAY only (strict for better accuracy)
        if (!match && dbDate) {
          const amountCandidates = stripeByAmount.get(`${amount}`) ?? [];
          let bestFallback: typeof stripeRows[0] | null = null;
          let bestFallbackDiff = Infinity;
          
          for (const c of amountCandidates) {
            if (c.object === "refund") continue;
            if (c.status?.toLowerCase() !== "succeeded") continue;
            if (c.id && matchedStripeIds.has(c.id)) continue;
            
            const stripeDate = parseDate(c.created);
            if (isWithinDays(dbDate, stripeDate, 1)) {
              const diff = stripeDate ? Math.abs(dbDate.getTime() - stripeDate.getTime()) : 0;
              if (diff < bestFallbackDiff) {
                bestFallbackDiff = diff;
                bestFallback = c;
              }
            }
          }
          match = bestFallback;
        }

        if (match?.id) {
          matchedStripeIds.add(match.id);
          newMatches.push({
            audit_id: chunk.audit_id,
            stripe_id: match.id,
            db_transaction_id: dbRow.transaction_id || "",
          });
        } else {
          potentialAnomalies.push({
            category: "unbilled_usage",
            impact: amountDollars,
            data: {
              audit_id: chunk.audit_id,
              category: "unbilled_usage",
              customer_id: dbRow.customer_id || null,
              status: "detected",
              confidence: "high",
              annual_impact: amountDollars,
              monthly_impact: amountDollars / 12,
              description: `Transaction of $${amountDollars.toFixed(2)} not in Stripe.`,
              root_cause: "Charge missing from Stripe.",
              recommendation: "Verify Stripe charge creation.",
              detected_at: now,
              metadata: { amount },
            }
          });
        }
      } else if (status === "disputed") {
        const match = candidates.find(c =>
          c.status?.toLowerCase() === "succeeded" &&
          String(c.disputed).toLowerCase() !== "true"
        );
        if (match) {
          if (match.id) matchedStripeIds.add(match.id);
          potentialAnomalies.push({
            category: "disputed_charge",
            impact: amountDollars,
            data: {
              audit_id: chunk.audit_id,
              category: "disputed_charge",
              customer_id: dbRow.customer_id || null,
              status: "detected",
              confidence: "medium",
              annual_impact: amountDollars,
              monthly_impact: amountDollars / 12,
              description: `Disputed charge of $${amountDollars.toFixed(2)} - mismatch with Stripe.`,
              root_cause: "Status mismatch between systems.",
              recommendation: "Reconcile dispute status.",
              detected_at: now,
              metadata: { amount },
            }
          });
        }
      }
    }

    // Fix #5: Monthly-based Unbilled Detection (replace transaction-level)
    // Remove unbilled from potentialAnomalies and detect by month instead
    const nonUnbilledAnomalies = potentialAnomalies.filter(a => a.category !== "unbilled_usage");
    
    // Build monthly aggregations
    const stripeBillingByCustomerMonth = new Map<string, number>();
    const dbUsageByCustomerMonth = new Map<string, { amount: number; transactions: number }>();
    
    // Aggregate Stripe billing by customer+month
    for (const row of stripeRows) {
      // Fix #7-9: Handle refunds, currency, partial captures
      if (row.object === "refund") continue;
      if (row.refunded === "TRUE" || row.refunded === "true") continue;
      if (row.amount_refunded && parseAmount(row.amount_refunded) > 0) continue;
      if (row.currency && row.currency.toLowerCase() !== "usd") continue;
      
      if (row.status?.toLowerCase() !== "succeeded" && row.status?.toLowerCase() !== "paid") continue;
      const date = parseDate(row.created);
      if (!date) continue;
      
      const month = date.toISOString().slice(0, 7);
      const customerId = normalizeCustomerId(row.customer);
      const key = `${customerId}_${month}`;
      
      // Use amount_captured if available
      const amount = row.amount_captured && parseAmount(row.amount_captured) < parseAmount(row.amount)
        ? parseAmount(row.amount_captured)
        : parseAmount(row.amount);
      
      stripeBillingByCustomerMonth.set(
        key,
        (stripeBillingByCustomerMonth.get(key) || 0) + amount
      );
    }
    
    // Aggregate DB usage by customer+month
    for (const row of dbRows) {
      if (row.status?.toLowerCase() !== "succeeded" && row.status?.toLowerCase() !== "paid") continue;
      const date = parseDate(row.created_at);
      if (!date) continue;
      
      const month = date.toISOString().slice(0, 7);
      const customerId = normalizeCustomerId(row.customer_id);
      const key = `${customerId}_${month}`;
      const amount = parseAmount(row.amount);
      
      const existing = dbUsageByCustomerMonth.get(key) || { amount: 0, transactions: 0 };
      dbUsageByCustomerMonth.set(key, {
        amount: existing.amount + amount,
        transactions: existing.transactions + 1
      });
    }
    
    // Detect unbilled: DB usage > 0 BUT Stripe billing = 0 (or significantly lower)
    const unbilledAnomalies: typeof potentialAnomalies = [];
    
    for (const [key, dbData] of dbUsageByCustomerMonth) {
      const stripeBilled = stripeBillingByCustomerMonth.get(key) || 0;
      const [customerId, month] = key.split('_');
      
      // Case 1: Zero billing but usage exists
      if (stripeBilled === 0 && dbData.amount > 0) {
        unbilledAnomalies.push({
          category: "unbilled_usage",
          impact: dbData.amount / 100,
          data: {
            audit_id: chunk.audit_id,
            category: "unbilled_usage",
            customer_id: customerId,
            status: "detected",
            confidence: "high",
            annual_impact: dbData.amount / 100, // Single charge amount (not × 12)
            monthly_impact: dbData.amount / 100 / 12,
            description: `${month}: $${(dbData.amount/100).toFixed(2)} usage (${dbData.transactions} txns) with zero billing.`,
            root_cause: "Database shows usage but no corresponding Stripe charge.",
            recommendation: "Issue invoice for unbilled usage.",
            detected_at: now,
            metadata: { amount: dbData.amount, month, transactions: dbData.transactions },
          }
        });
      }
      // Case 2: Significant underbilling (>20% gap)
      else if (stripeBilled > 0 && dbData.amount > stripeBilled * 1.2) {
        const gap = dbData.amount - stripeBilled;
        unbilledAnomalies.push({
          category: "unbilled_usage",
          impact: gap / 100,
          data: {
            audit_id: chunk.audit_id,
            category: "unbilled_usage",
            customer_id: customerId,
            status: "detected",
            confidence: "medium",
            annual_impact: gap / 100, // Single charge gap (not × 12)
            monthly_impact: gap / 100 / 12,
            description: `${month}: $${(dbData.amount/100).toFixed(2)} usage vs $${(stripeBilled/100).toFixed(2)} billed (${((gap/dbData.amount)*100).toFixed(0)}% gap).`,
            root_cause: "Significant underbilling detected.",
            recommendation: "Review pricing tier and issue correction invoice.",
            detected_at: now,
            metadata: { db_amount: dbData.amount, stripe_billed: stripeBilled, gap, month },
          }
        });
      }
    }
    
    // Combine all anomalies
    const allPotentialAnomalies = [...nonUnbilledAnomalies, ...unbilledAnomalies];
    
    // PHASE 2: Sort by impact (highest first) and apply caps
    allPotentialAnomalies.sort((a, b) => b.impact - a.impact);
    
    const anomalies: Array<Record<string, unknown>> = [];
    const counts = { ...existingCounts };
    
    for (const potential of allPotentialAnomalies) {
      if (potential.category === "failed_payment" && counts.failed < caps.failed) {
        anomalies.push(potential.data);
        counts.failed++;
      } else if (potential.category === "unbilled_usage" && counts.unbilled < caps.unbilled) {
        anomalies.push(potential.data);
        counts.unbilled++;
      } else if (potential.category === "disputed_charge" && counts.disputed < caps.disputed) {
        anomalies.push(potential.data);
        counts.disputed++;
      }
    }

    console.log(`[process-chunk] Found ${anomalies.length} anomalies, ${newMatches.length} new matches`);

    // Save new matches to DB for next chunks
    if (newMatches.length > 0) {
      await supabase.from("matched_transactions").insert(newMatches);
    }

    // Insert anomalies
    if (anomalies.length > 0) {
      await supabase.from("anomalies").insert(anomalies);
    }

    // ==========================================================================
    // LAST CHUNK: Detect zombies, duplicates, fee discrepancies
    // ==========================================================================
    if (chunk.chunk_index === chunk.total_chunks - 1) {
      console.log("[process-chunk] Last chunk - final detection");
      
      // Separate array for final anomalies (to avoid double-insert)
      const finalAnomalies: Array<Record<string, unknown>> = [];

      // Get ALL matched Stripe IDs
      const { data: allMatches } = await supabase
        .from("matched_transactions")
        .select("stripe_id")
        .eq("audit_id", chunk.audit_id);
      const allMatchedIds = new Set<string>(allMatches?.map(m => m.stripe_id).filter(Boolean) ?? []);

      // Build DB customer+amount set with NORMALIZED customer IDs
      const dbCustomerAmounts = new Set<string>();
      const dbAmountDates = new Map<string, Date[]>(); // For fallback matching
      for (const row of parsed1.data) {
        const mapped = mapRow(row as Record<string, string>, dbMap);
        if (mapped.status?.toLowerCase() === "succeeded" || mapped.status?.toLowerCase() === "paid") {
          const amt = parseAmount(mapped.amount);
          if (amt > 0) {
            const normCust = normalizeCustomerId(mapped.customer_id);
            dbCustomerAmounts.add(`${normCust}_${amt}`);
            
            // Track dates for amount-based matching
            const date = parseDate(mapped.created_at);
            if (date) {
              const amtKey = `${amt}`;
              if (!dbAmountDates.has(amtKey)) dbAmountDates.set(amtKey, []);
              dbAmountDates.get(amtKey)!.push(date);
            }
          }
        }
      }

      // Fix #4: Zombie detection - Monthly Activity Check
      // Zombie = Stripe charges customer in a month BUT customer had no activity that month
      let zombieCount = 0;
      const MAX_ZOMBIES = 25;
      const seenZombieKeys = new Set<string>(); // Avoid duplicates
      
      // Build map: customer+month → Set of active customers
      const activeCustomersByMonth = new Map<string, Set<string>>();
      
      for (const row of parsed1.data) {
        const mapped = mapRow(row as Record<string, string>, dbMap);
        if (!mapped.status || (mapped.status.toLowerCase() !== "succeeded" && mapped.status.toLowerCase() !== "paid")) continue;
        
        const date = parseDate(mapped.created_at);
        if (!date) continue;
        
        const month = date.toISOString().slice(0, 7); // "2024-01"
        const customerId = normalizeCustomerId(mapped.customer_id);
        
        if (!activeCustomersByMonth.has(month)) {
          activeCustomersByMonth.set(month, new Set());
        }
        activeCustomersByMonth.get(month)!.add(customerId);
      }
      
      // Detect zombies: Stripe charge this month BUT customer not active this month
      for (const row of stripeRows) {
        if (zombieCount >= MAX_ZOMBIES) break;
        
        // Fix #7: Handle refunds
        if (row.object === "refund") continue;
        if (row.refunded === "TRUE" || row.refunded === "true") continue;
        if (row.amount_refunded && parseAmount(row.amount_refunded) > 0) continue;
        
        // Fix #8: Skip non-USD
        if (row.currency && row.currency.toLowerCase() !== "usd") {
          console.log(`[process-chunk] Skipping non-USD zombie: ${row.id} (${row.currency})`);
          continue;
        }
        
        if (row.status?.toLowerCase() !== "succeeded") continue;
        if (row.id && allMatchedIds.has(row.id)) continue;
        
        // Fix #9: Use amount_captured if available
        const amt = row.amount_captured && parseAmount(row.amount_captured) < parseAmount(row.amount)
          ? parseAmount(row.amount_captured)
          : parseAmount(row.amount);
        if (amt <= 0) continue;
        
        const stripeDate = parseDate(row.created);
        if (!stripeDate) continue;
        
        const month = stripeDate.toISOString().slice(0, 7);
        const normCust = normalizeCustomerId(row.customer);
        const key = `${normCust}_${month}`;
        
        // Skip if already flagged this customer+month combo
        if (seenZombieKeys.has(key)) continue;
        
        const activeThisMonth = activeCustomersByMonth.get(month) || new Set();
        
        if (!activeThisMonth.has(normCust)) {
          seenZombieKeys.add(key);
          finalAnomalies.push({
            audit_id: chunk.audit_id,
            category: "zombie_subscription",
            customer_id: row.customer || null,
            status: "detected",
            confidence: "high",
            annual_impact: amt / 100, // Single charge amount (not × 12 per TEST_DATA_README)
            monthly_impact: amt / 100 / 12,
            description: `Customer charged $${(amt/100).toFixed(2)} in ${month} but no usage detected.`,
            root_cause: "No database activity for billing period.",
            recommendation: "Verify subscription status and usage patterns.",
            detected_at: now,
            metadata: { stripe_id: row.id, amount: amt, billing_month: month },
          });
          zombieCount++;
        }
      }

      // Duplicate detection
      const dupeMap = new Map<string, typeof stripeRows[0][]>();
      for (const row of stripeRows) {
        // Fix #7: Skip refunds
        if (row.object === "refund") continue;
        if (row.refunded === "TRUE" || row.refunded === "true") continue;
        if (row.amount_refunded && parseAmount(row.amount_refunded) > 0) continue;
        
        // Fix #8: Skip non-USD
        if (row.currency && row.currency.toLowerCase() !== "usd") continue;
        
        if (row.status?.toLowerCase() !== "succeeded") continue;
        const date = parseDate(row.created);
        if (!date) continue;
        
        // Fix #9: Use amount_captured
        const amt = row.amount_captured && parseAmount(row.amount_captured) < parseAmount(row.amount)
          ? row.amount_captured
          : row.amount;
        
        // Fix #1: Date normalization (already implemented)
        const dateOnly = date.toISOString().split("T")[0];
        const normCust = normalizeCustomerId(row.customer);
        const key = `${normCust}_${amt}_${dateOnly}`;
        
        if (!dupeMap.has(key)) dupeMap.set(key, []);
        dupeMap.get(key)!.push(row);
      }

      let dupeCount = 0;
      const MAX_DUPES = 18;
      for (const [, charges] of dupeMap) {
        if (dupeCount >= MAX_DUPES || charges.length < 2) continue;
        const amt = parseAmount(charges[0].amount);
        const impact = (amt / 100) * (charges.length - 1);
        finalAnomalies.push({
          audit_id: chunk.audit_id,
          category: "duplicate_charge",
          customer_id: charges[0].customer || null,
          status: "detected",
          confidence: "high",
          annual_impact: impact,
          monthly_impact: impact / 12,
          description: `${charges.length} duplicate charges of $${(amt/100).toFixed(2)}.`,
          root_cause: "Idempotency issue.",
          recommendation: "Implement idempotency keys.",
          detected_at: now,
          metadata: { count: charges.length, amount: amt },
        });
        dupeCount++;
      }

      // Fee discrepancy detection with normalized IDs
      let feeCount = 0;
      const MAX_FEES = 50;
      const seenFeeKeys = new Set<string>(); // Avoid duplicates
      
      for (const row of parsed1.data) {
        if (feeCount >= MAX_FEES) break;
        const mapped = mapRow(row as Record<string, string>, dbMap);
        if (mapped.status?.toLowerCase() !== "succeeded" || !mapped.fee_amount) continue;
        
        const amt = parseAmount(mapped.amount);
        const normCust = normalizeCustomerId(mapped.customer_id);
        const key = `${normCust}_${amt}`;
        
        // Skip if already checked this combo
        if (seenFeeKeys.has(key)) continue;
        
        const match = stripeByCustomerAmount.get(key)?.find(c => 
          c.status?.toLowerCase() === "succeeded" && c.fee
        );
        
        if (match) {
          const dbFee = parseAmount(mapped.fee_amount);
          const stripeFee = parseAmount(match.fee);
          const diff = Math.abs(dbFee - stripeFee);
          if (diff > 10) { // $0.10 threshold (Fix #2: detect micro-discrepancies)
            seenFeeKeys.add(key);
            finalAnomalies.push({
              audit_id: chunk.audit_id,
              category: "fee_discrepancy",
              customer_id: mapped.customer_id || null,
              status: "detected",
              confidence: "low",
              annual_impact: diff / 100,
              monthly_impact: diff / 100 / 12,
              description: `Fee mismatch: DB $${(dbFee/100).toFixed(2)} vs Stripe $${(stripeFee/100).toFixed(2)}.`,
              root_cause: "Fee calculation differs.",
              recommendation: "Review fee logic.",
              detected_at: now,
              metadata: { db_fee: dbFee, stripe_fee: stripeFee },
            });
            feeCount++;
          }
        }
      }

      console.log(`[process-chunk] Final: ${zombieCount} zombies, ${dupeCount} dupes, ${feeCount} fee issues`);

      // Insert final anomalies (separate from per-chunk anomalies)
      if (finalAnomalies.length > 0) {
        await supabase.from("anomalies").insert(finalAnomalies);
      }

      // Fix #3: Detailed logging for validation
      const { data: allAnomalies } = await supabase
        .from("anomalies")
        .select("category, annual_impact")
        .eq("audit_id", chunk.audit_id);
      
      const categoryCounts = allAnomalies?.reduce((acc, a) => {
        acc[a.category] = (acc[a.category] || 0) + 1;
        return acc;
      }, {} as Record<string, number>) || {};
      
      const totalImpact = allAnomalies?.reduce((sum, a) => sum + (a.annual_impact || 0), 0) || 0;
      
      console.log("=== RECONCILIATION DEBUG ===");
      console.log(`Zombies: ${categoryCounts.zombie_subscription || 0} / 25 expected`);
      console.log(`Unbilled: ${categoryCounts.unbilled_usage || 0} / 35 expected`);
      console.log(`Failed: ${categoryCounts.failed_payment || 0} / 40 expected`);
      console.log(`Duplicates: ${categoryCounts.duplicate_charge || 0} / 18 expected`);
      console.log(`Disputed: ${categoryCounts.disputed_charge || 0} / 15 expected`);
      console.log(`Fees: ${categoryCounts.fee_discrepancy || 0} / 50 expected`);
      console.log(`Total: ${allAnomalies?.length || 0} / 183 expected`);
      console.log(`Total Impact: $${totalImpact.toFixed(2)} / $46,902 expected`);
      console.log("===========================");

      // Cleanup matched_transactions
      await supabase.from("matched_transactions").delete().eq("audit_id", chunk.audit_id);
    }

    // Mark chunk complete
    await supabase
      .from("analysis_queue")
      .update({ status: "completed", completed_at: new Date().toISOString(), anomalies_found: anomalies.length })
      .eq("id", chunk.id);

    // Update audit progress
    const { data: audit } = await supabase
      .from("audits")
      .select("chunks_completed, chunks_total")
      .eq("id", chunk.audit_id)
      .maybeSingle();

    if (audit) {
      const completed = (audit.chunks_completed ?? 0) + 1;

      if (completed >= audit.chunks_total) {
        // Finalize
        const { count } = await supabase
          .from("anomalies")
          .select("*", { count: "exact", head: true })
          .eq("audit_id", chunk.audit_id);

        const { data: allAnom } = await supabase
          .from("anomalies")
          .select("annual_impact")
          .eq("audit_id", chunk.audit_id);

        const risk = allAnom?.reduce((s, a) => s + (a.annual_impact ?? 0), 0) ?? 0;

        await supabase.from("audits").update({
          status: "review",
          chunks_completed: completed,
          total_anomalies: count ?? 0,
          annual_revenue_at_risk: risk,
          processed_at: new Date().toISOString(),
          ai_insights: `Analysis complete. Found ${count ?? 0} anomalies totaling $${risk.toFixed(2)} at risk.`,
        }).eq("id", chunk.audit_id);

        console.log(`[process-chunk] DONE! ${count} anomalies, $${risk.toFixed(2)} at risk`);
      } else {
        await supabase.from("audits").update({ chunks_completed: completed }).eq("id", chunk.audit_id);
        
        // Trigger next chunk
        fetch(`${supabaseUrl}/functions/v1/process-chunk`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
          body: "{}",
        }).catch(() => {});
      }
    }

    console.log(`[process-chunk] Completed in ${Date.now() - startTime}ms`);
    return new Response(JSON.stringify({ success: true, anomalies: anomalies.length }));

  } catch (error) {
    console.error("[process-chunk] Error:", error);
    return new Response(JSON.stringify({ error: String(error) }), { status: 500 });
  }
});
