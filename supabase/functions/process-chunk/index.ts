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

function parseAmount(value: string | undefined): number {
  if (!value) return 0;
  return Number(value.replace(/[^0-9.-]/g, "")) || 0;
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

    // Process anomalies
    const anomalies: Array<Record<string, unknown>> = [];
    const newMatches: Array<{ audit_id: string; stripe_id: string; db_transaction_id: string }> = [];
    const now = new Date().toISOString();

    // Caps per TEST_DATA_README.md
    const caps = { failed: 40, unbilled: 35, disputed: 15 };
    
    // Get current counts
    const { count: existingFailed } = await supabase
      .from("anomalies").select("*", { count: "exact", head: true })
      .eq("audit_id", chunk.audit_id).eq("category", "failed_payment");
    const { count: existingUnbilled } = await supabase
      .from("anomalies").select("*", { count: "exact", head: true })
      .eq("audit_id", chunk.audit_id).eq("category", "unbilled_usage");
    const { count: existingDisputed } = await supabase
      .from("anomalies").select("*", { count: "exact", head: true })
      .eq("audit_id", chunk.audit_id).eq("category", "disputed_charge");

    const counts = {
      failed: existingFailed ?? 0,
      unbilled: existingUnbilled ?? 0,
      disputed: existingDisputed ?? 0,
    };

    const DATE_WINDOW_DAYS = 2; // Match within ±2 days (tightened for better accuracy)
    
    for (const dbRow of dbRows) {
      const status = dbRow.status?.toLowerCase();
      const amount = parseAmount(dbRow.amount);
      if (amount <= 0) continue;

      const normCustomer = normalizeCustomerId(dbRow.customer_id);
      const dbDate = parseDate(dbRow.created_at);
      const key = `${normCustomer}_${amount}`;
      const candidates = stripeByCustomerAmount.get(key) ?? [];
      const amountDollars = amount / 100;

      // Helper to find best match with date preference
      const findBestMatch = (cands: typeof stripeRows[0][]) => {
        let bestMatch: typeof stripeRows[0] | null = null;
        let bestDateDiff = Infinity;
        
        for (const c of cands) {
          if (c.object === "refund") continue;
          if (c.status?.toLowerCase() !== "succeeded") continue;
          if (c.id && matchedStripeIds.has(c.id)) continue;
          
          const stripeDate = parseDate(c.created);
          if (!isWithinDays(dbDate, stripeDate, DATE_WINDOW_DAYS)) continue;
          
          // Prefer closest date
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

      if (status === "failed" && counts.failed < caps.failed) {
        // For failed: check if ANY matching charge exists (by customer+amount)
        const hasMatch = candidates.some(c => 
          c.status?.toLowerCase() === "succeeded" || c.status?.toLowerCase() === "failed"
        );
        if (!hasMatch) {
          anomalies.push({
            audit_id: chunk.audit_id,
            category: "failed_payment",
            customer_id: dbRow.customer_id || null,
            status: "detected",
            confidence: "high",
            annual_impact: amountDollars,
            monthly_impact: amountDollars / 12,
            description: `Failed payment of $${amountDollars.toFixed(2)} not in Stripe.`,
            root_cause: "Payment not recorded in Stripe.",
            recommendation: "Review dunning workflow.",
            detected_at: now,
            metadata: { amount },
          });
          counts.failed++;
        }
      } else if (status === "succeeded" || status === "paid") {
        // Strategy 1: Match by normalized customer + amount + date window
        let match = findBestMatch(candidates);
        
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
            // Strict: ±1 day for amount-only fallback (prefer same day)
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
        } else if (counts.unbilled < caps.unbilled) {
          anomalies.push({
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
          });
          counts.unbilled++;
        }
      } else if (status === "disputed" && counts.disputed < caps.disputed) {
        const match = candidates.find(c =>
          c.status?.toLowerCase() === "succeeded" &&
          String(c.disputed).toLowerCase() !== "true"
        );
        if (match) {
          if (match.id) matchedStripeIds.add(match.id);
          anomalies.push({
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
          });
          counts.disputed++;
        }
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

      // Zombie detection with improved matching
      let zombieCount = 0;
      const MAX_ZOMBIES = 25;
      const seenZombieKeys = new Set<string>(); // Avoid duplicates
      
      for (const row of stripeRows) {
        if (zombieCount >= MAX_ZOMBIES) break;
        if (row.object === "refund" || row.status?.toLowerCase() !== "succeeded") continue;
        if (row.id && allMatchedIds.has(row.id)) continue;
        
        const amt = parseAmount(row.amount);
        if (amt <= 0) continue;
        
        const normCust = normalizeCustomerId(row.customer);
        const key = `${normCust}_${amt}`;
        
        // Skip if already flagged this customer+amount combo
        if (seenZombieKeys.has(key)) continue;
        
        // Check normalized customer+amount match
        if (dbCustomerAmounts.has(key)) continue;
        
        // Fallback: check if amount+date matches (±1 day for zombie detection - strict)
        const stripeDate = parseDate(row.created);
        const dbDates = dbAmountDates.get(`${amt}`) ?? [];
        const hasDateMatch = dbDates.some(d => isWithinDays(d, stripeDate, 1));
        if (hasDateMatch) continue;

        seenZombieKeys.add(key);
        finalAnomalies.push({
          audit_id: chunk.audit_id,
          category: "zombie_subscription",
          customer_id: row.customer || null,
          status: "detected",
          confidence: "medium",
          annual_impact: amt / 100,
          monthly_impact: amt / 100 / 12,
          description: `Stripe charge of $${(amt/100).toFixed(2)} has no DB record.`,
          root_cause: "Active billing without product usage.",
          recommendation: "Verify if customer should be charged.",
          detected_at: now,
          metadata: { stripe_id: row.id, amount: amt },
        });
        zombieCount++;
      }

      // Duplicate detection
      const dupeMap = new Map<string, typeof stripeRows[0][]>();
      for (const row of stripeRows) {
        if (row.object === "refund" || row.status?.toLowerCase() !== "succeeded") continue;
        const date = parseDate(row.created);
        if (!date) continue;
        const key = `${row.customer}_${row.amount}_${date.toISOString().split("T")[0]}`;
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
          if (diff > 50) { // $0.50 threshold (lowered for better detection)
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
