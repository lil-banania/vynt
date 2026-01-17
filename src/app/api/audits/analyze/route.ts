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

function formatCurrency(cents: number): string {
  return `€${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

  const file1Headers = file1Result.meta.fields ?? [];
  const file2Headers = file2Result.meta.fields ?? [];

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

    const dbRows = file1Result.data.map((row) => mapRow(row, dbMapping));
    const stripeRows = file2Result.data.map((row) => mapRow(row, stripeMapping));

    // Build lookup maps
    const stripeById = new Map<string, typeof stripeRows[0]>();
    const stripeByCustomerAmount = new Map<string, typeof stripeRows[0][]>();
    
    for (const row of stripeRows) {
      if (row.id) stripeById.set(row.id, row);
      
      const key = `${row.customer}_${row.amount}`;
      if (!stripeByCustomerAmount.has(key)) stripeByCustomerAmount.set(key, []);
      stripeByCustomerAmount.get(key)!.push(row);
    }

    const dbByCustomerAmount = new Map<string, typeof dbRows[0][]>();
    for (const row of dbRows) {
      const key = `${row.customer_id}_${row.amount}`;
      if (!dbByCustomerAmount.has(key)) dbByCustomerAmount.set(key, []);
      dbByCustomerAmount.get(key)!.push(row);
    }

    // Track which Stripe rows have been matched
    const matchedStripeIds = new Set<string>();

    // ========================================================================
    // ANOMALY 1: Transactions in DB but missing from Stripe
    // ========================================================================
    for (const dbRow of dbRows) {
      if (dbRow.status?.toLowerCase() === "failed") {
        // Check if failed transaction is missing from Stripe
        const stripeMatch = stripeRows.find(s => 
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
            annual_impact: amount * 0.12, // Estimate 12 months
            monthly_impact: amount / 100,
            description: `Failed payment for ${dbRow.customer_name || dbRow.customer_id} (${formatCurrency(amount)}) is recorded in DB but completely absent from Stripe export.`,
            root_cause: "Failed payments may not sync to Stripe export, or the payment attempt was not recorded in Stripe.",
            recommendation: "Review payment gateway logs. Ensure failed payment attempts are properly tracked for dunning sequences.",
            detected_at: now,
            metadata: { db_transaction_id: dbRow.transaction_id, amount, customer: dbRow.customer_email },
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
          description: `Customer ${customer} has ${charges.length} identical charges of ${formatCurrency(amount)} on the same date. Charge IDs: ${ids}`,
          root_cause: "Double-click on payment button, webhook retry issue, or manual billing error.",
          recommendation: "Implement idempotency keys. Review and refund confirmed duplicates (${formatCurrency(amount)} at risk).",
          detected_at: now,
          metadata: { charge_ids: charges.map(c => c.id), amount, count: charges.length },
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
          anomalies.push({
            audit_id: auditId,
            category: "dispute_chargeback",
            customer_id: dbRow.customer_id || null,
            status: "detected",
            confidence: "high",
            annual_impact: (amount / 100) * 12 + 15, // Include chargeback fee
            monthly_impact: amount / 100,
            description: `Dispute for ${dbRow.customer_name || dbRow.customer_id}: DB shows "disputed" status but Stripe still shows "succeeded". Amount: ${formatCurrency(amount)}`,
            root_cause: "Status sync delay between Stripe and internal DB, or dispute opened but not yet reflected in charge status.",
            recommendation: "Verify dispute status in Stripe dashboard. Update internal records. Prepare dispute evidence if needed.",
            detected_at: now,
            metadata: { 
              db_status: dbRow.status, 
              stripe_status: stripeMatch.status, 
              stripe_disputed: stripeMatch.disputed,
              amount 
            },
          });
        }
      }
    }

    // ========================================================================
    // ANOMALY 4: Unreconciled transactions (missing payout_id)
    // ========================================================================
    const unreconciledCharges = stripeRows.filter(row => 
      row.object !== "refund" && 
      row.status?.toLowerCase() === "succeeded" &&
      (!row.payout_id || row.payout_id.trim() === "")
    );

    if (unreconciledCharges.length > 0) {
      const totalUnreconciled = unreconciledCharges.reduce((sum, c) => sum + parseAmount(c.amount), 0);
      const customers = [...new Set(unreconciledCharges.map(c => c.customer))].slice(0, 5);
      
      anomalies.push({
        audit_id: auditId,
        category: "unbilled_usage",
        customer_id: "MULTIPLE",
        status: "detected",
        confidence: "medium",
        annual_impact: totalUnreconciled / 100 * 0.05, // 5% risk of issues
        monthly_impact: totalUnreconciled / 100 / 12,
        description: `${unreconciledCharges.length} transaction(s) totaling ${formatCurrency(totalUnreconciled)} are pending payout (no payout_id). Affected customers: ${customers.join(", ")}...`,
        root_cause: "Transactions are in processing queue, payout schedule delay, or bank transfer pending.",
        recommendation: "Review Stripe payout schedule. Verify bank account is properly connected. Check for any holds on the account.",
        detected_at: now,
        metadata: { 
          count: unreconciledCharges.length, 
          total_amount: totalUnreconciled,
          transaction_ids: unreconciledCharges.map(c => c.id).slice(0, 10)
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

    if (totalFeeDiscrepancy > 100) { // More than €1 in fee discrepancies
      anomalies.push({
        audit_id: auditId,
        category: "pricing_mismatch",
        customer_id: "MULTIPLE",
        status: "detected",
        confidence: feeDiscrepancies.length > 5 ? "high" : "medium",
        annual_impact: totalFeeDiscrepancy / 100 * 12,
        monthly_impact: totalFeeDiscrepancy / 100,
        description: `Fee discrepancy detected across ${feeDiscrepancies.length} transaction(s). Total difference: ${formatCurrency(totalFeeDiscrepancy)}. DB fees don't match Stripe fees.`,
        root_cause: "Rounding differences, different fee calculation methods, or outdated fee rates in internal system.",
        recommendation: "Audit fee calculation logic. Sync fee rates with current Stripe pricing. Consider using Stripe fees as source of truth.",
        detected_at: now,
        metadata: { 
          total_discrepancy: totalFeeDiscrepancy,
          transaction_count: feeDiscrepancies.length,
          samples: feeDiscrepancies.slice(0, 5)
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
          
          if (diffDays > 1) {
            const amount = parseAmount(dbRow.amount);
            anomalies.push({
              audit_id: auditId,
              category: "other",
              customer_id: dbRow.customer_id || null,
              status: "detected",
              confidence: diffDays > 3 ? "high" : "medium",
              annual_impact: 0, // No direct financial impact
              monthly_impact: 0,
              description: `Timing mismatch for ${dbRow.customer_name || dbRow.customer_id}: DB shows ${dbDate.toISOString().split("T")[0]}, Stripe shows ${stripeDate.toISOString().split("T")[0]} (${Math.round(diffDays)} days difference). Amount: ${formatCurrency(amount)}`,
              root_cause: "Timezone differences, processing delays, or manual entry discrepancies.",
              recommendation: "Standardize timestamp handling. Use Stripe created_at as source of truth for reporting.",
              detected_at: now,
              metadata: { 
                db_date: dbDate.toISOString(), 
                stripe_date: stripeDate.toISOString(),
                diff_days: diffDays,
                amount
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
    
    const stripeRefundObjects = stripeRows.filter(r => r.object === "refund");
    const stripeChargesWithRefund = stripeRows.filter(r => parseAmount(r.amount_refunded) > 0);

    if (dbRefunds.length > 0) {
      const unmatchedRefunds: typeof dbRows = [];
      
      for (const dbRefund of dbRefunds) {
        const amount = Math.abs(parseAmount(dbRefund.amount));
        
        // Check if there's a matching refund object or amount_refunded in Stripe
        const hasStripeRefundObject = stripeRefundObjects.some(r => 
          parseAmount(r.amount) === amount
        );
        const hasAmountRefunded = stripeChargesWithRefund.some(r => 
          parseAmount(r.amount_refunded) === amount
        );
        
        if (!hasStripeRefundObject && !hasAmountRefunded) {
          unmatchedRefunds.push(dbRefund);
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
          description: `${unmatchedRefunds.length} refund(s) in DB totaling ${formatCurrency(totalUnmatched)} cannot be matched to Stripe refund records.`,
          root_cause: "Different refund recording methods between DB and Stripe (inline amount_refunded vs separate refund object).",
          recommendation: "Standardize refund tracking. Cross-reference with Stripe refund events. Verify all refunds are properly processed.",
          detected_at: now,
          metadata: { 
            unmatched_count: unmatchedRefunds.length,
            total_amount: totalUnmatched,
            db_refunds: unmatchedRefunds.map(r => r.transaction_id).slice(0, 5)
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
      .filter(([_, txns]) => txns.length >= 3)
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
        description: `Grouped payout detected: ${payoutId} bundles ${transactions.length} transactions totaling ${formatCurrency(totalAmount)}. Individual transaction matching may be complex.`,
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
    
    if (grossDiff > 100) { // More than €1 difference
      anomalies.push({
        audit_id: auditId,
        category: "revenue_leakage",
        customer_id: "SUMMARY",
        status: "detected",
        confidence: grossDiff > 10000 ? "high" : "medium",
        annual_impact: grossDiff / 100 * 12,
        monthly_impact: grossDiff / 100,
        description: `Gross revenue discrepancy: DB shows ${formatCurrency(dbTotalGross)}, Stripe shows ${formatCurrency(stripeTotalGross)}. Difference: ${formatCurrency(grossDiff)}`,
        root_cause: "Duplicate transactions in Stripe, missing transactions in DB, or timing differences.",
        recommendation: "Perform line-by-line reconciliation. Identify and resolve individual transaction discrepancies.",
        detected_at: now,
        metadata: { 
          db_gross: dbTotalGross,
          stripe_gross: stripeTotalGross,
          difference: grossDiff
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

    const usageRows = file1Result.data.map((row) => mapRow(row, usageMapping));
    const stripeRows = file2Result.data.map((row) => mapRow(row, stripeMapping));

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

  // VALID database categories - only these are allowed by the CHECK constraint
  const VALID_CATEGORIES = ["zombie_subscription", "unbilled_usage", "pricing_mismatch", "duplicate_charge", "other"] as const;
  type ValidCategory = typeof VALID_CATEGORIES[number];

  // Map new/extended categories to valid database categories
  const categoryMapping: Record<string, ValidCategory> = {
    zombie_subscription: "zombie_subscription",
    unbilled_usage: "unbilled_usage",
    pricing_mismatch: "pricing_mismatch",
    duplicate_charge: "duplicate_charge",
    failed_payment: "pricing_mismatch",
    high_refund_rate: "pricing_mismatch",
    dispute_chargeback: "duplicate_charge",
    trial_abuse: "other",
    revenue_leakage: "unbilled_usage",
    involuntary_churn: "other",
    other: "other",
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
      // Map category to valid value, default to "other"
      let mappedCategory = categoryMapping[a.category];
      
      // If not found in mapping, use "other"
      if (!mappedCategory) {
        console.warn(`Unknown category "${a.category}", mapping to "other"`);
        mappedCategory = "other";
      }
      
      // Double-check it's a valid category
      if (!VALID_CATEGORIES.includes(mappedCategory as ValidCategory)) {
        console.error(`Invalid mapped category "${mappedCategory}", forcing to "other"`);
        mappedCategory = "other";
      }
      
      // TEMPORARY FIX: Force all to "other" to test if category is the issue
      mappedCategory = "other";
      
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
  for (const row of file1Result.data) {
    const dateFields = ["created_at", "timestamp", "date", "created"];
    for (const field of dateFields) {
      const value = row[field as keyof typeof row];
      if (value) {
        const date = parseDate(String(value));
        if (date) allTimestamps.push(date.getTime());
      }
    }
  }
  for (const row of file2Result.data) {
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
