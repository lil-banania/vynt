import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import Papa from "papaparse";

import { createClient as createServerClient } from "@/lib/supabase/server";

// Flexible column mapping hints
const USAGE_COLUMN_HINTS: Record<string, string[]> = {
  customer_id: ["customer_id", "customer", "cust_id", "user_id", "account_id", "client_id", "subscriber_id"],
  timestamp: ["timestamp", "date", "created_at", "event_date", "time", "created", "occurred_at"],
  quantity: ["quantity", "amount", "count", "units", "value", "usage", "qty", "volume"],
  event_type: ["event_type", "type", "event", "action", "category", "plan", "product"],
  event_id: ["event_id", "id", "uuid", "transaction_id", "record_id"],
};

const STRIPE_COLUMN_HINTS: Record<string, string[]> = {
  customer: ["customer", "customer_id", "cust_id", "stripe_customer_id", "client_id", "subscriber"],
  amount: ["amount", "total", "charge_amount", "price", "value", "sum", "amount_paid", "net"],
  status: ["status", "state", "payment_status", "charge_status", "outcome"],
  created: ["created", "date", "timestamp", "created_at", "payment_date", "charged_at"],
  id: ["id", "charge_id", "payment_id", "transaction_id", "stripe_id", "invoice_id"],
  currency: ["currency", "curr"],
  description: ["description", "memo", "note", "product", "plan"],
  invoice: ["invoice", "invoice_id", "inv_id"],
  subscription: ["subscription", "subscription_id", "sub_id"],
  refunded: ["refunded", "refund_amount", "amount_refunded"],
  disputed: ["disputed", "dispute", "dispute_amount"],
  fee: ["fee", "stripe_fee", "processing_fee", "application_fee"],
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

  const usageFile = files.find((f) => f.file_type === "usage_logs");
  const stripeFile = files.find((f) => f.file_type === "stripe_export");

  if (!usageFile || !stripeFile) {
    return NextResponse.json({ error: "Both files are required." }, { status: 400 });
  }

  // Download CSVs
  const { data: usageCsvData } = await adminSupabase.storage.from("audit-files").download(usageFile.file_path);
  const { data: stripeCsvData } = await adminSupabase.storage.from("audit-files").download(stripeFile.file_path);

  if (!usageCsvData || !stripeCsvData) {
    return NextResponse.json({ error: "Failed to download files." }, { status: 500 });
  }

  const usageCsvText = await usageCsvData.text();
  const stripeCsvText = await stripeCsvData.text();

  const usageResult = Papa.parse<Record<string, string>>(usageCsvText, { header: true, skipEmptyLines: true });
  const stripeResult = Papa.parse<Record<string, string>>(stripeCsvText, { header: true, skipEmptyLines: true });

  const usageHeaders = usageResult.meta.fields ?? [];
  const stripeHeaders = stripeResult.meta.fields ?? [];

  // Auto-map columns
  const usageMapping: Record<string, string | null> = {};
  for (const [key, hints] of Object.entries(USAGE_COLUMN_HINTS)) {
    usageMapping[key] = findColumn(usageHeaders, hints);
  }

  const stripeMapping: Record<string, string | null> = {};
  for (const [key, hints] of Object.entries(STRIPE_COLUMN_HINTS)) {
    stripeMapping[key] = findColumn(stripeHeaders, hints);
  }

  // Map rows
  const usageRows = usageResult.data.map((row) => mapRow(row, usageMapping));
  const stripeRows = stripeResult.data.map((row) => mapRow(row, stripeMapping));

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
  const anomalies: AnomalyInsert[] = [];
  const now = new Date().toISOString();

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
      c.status?.toLowerCase() === "refunded" || Number(c.refunded) > 0
    );
    const disputedCharges = stripeCharges.filter((c) => 
      c.status?.toLowerCase() === "disputed" || c.disputed === "true"
    );

    const totalUsage = usageEvents.reduce((sum, e) => sum + (Number(e.quantity) || 0), 0);
    const totalCharged = succeededCharges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0) / 100;
    const totalFailed = failedCharges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0) / 100;
    const totalRefunded = refundedCharges.reduce((sum, c) => sum + (Number(c.refunded || c.amount) || 0), 0) / 100;
    const totalDisputed = disputedCharges.reduce((sum, c) => sum + (Number(c.disputed || c.amount) || 0), 0) / 100;

    // 1. ZOMBIE SUBSCRIPTION - Charges but no usage
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

    // 2. UNBILLED USAGE - Usage but no successful charges
    if (usageEvents.length > 0 && succeededCharges.length === 0) {
      const estimatedRevenue = totalUsage * 0.05; // Estimate $0.05 per unit
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

    // 3. FAILED PAYMENTS - Payment failures
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

    // 4. HIGH REFUND RATE
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
        metadata: { refund_count: refundedCharges.length, refund_amount: totalRefunded, refund_rate: totalRefunded / (totalCharged + totalRefunded) },
      });
    }

    // 5. DISPUTES / CHARGEBACKS
    if (disputedCharges.length > 0) {
      anomalies.push({
        audit_id: auditId,
        category: "dispute_chargeback",
        customer_id: customerId,
        status: "detected",
        confidence: "high",
        annual_impact: totalDisputed * 12 + (disputedCharges.length * 15), // $15 chargeback fee per dispute
        monthly_impact: totalDisputed + (disputedCharges.length * 15),
        description: `Customer ${customerId} has ${disputedCharges.length} disputed charge(s) totaling $${totalDisputed.toFixed(2)} plus ~$${disputedCharges.length * 15} in fees.`,
        root_cause: "Customer did not recognize charge, fraud, or service not delivered as expected.",
        recommendation: "Improve descriptor clarity. Respond to disputes promptly with evidence. Review fraud prevention measures.",
        detected_at: now,
        metadata: { dispute_count: disputedCharges.length, dispute_amount: totalDisputed },
      });
    }

    // 6. DUPLICATE CHARGES - Same day, same amount
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

    // 7. TRIAL ABUSE - Multiple small charges or free tier
    if (succeededCharges.length >= 3 && totalCharged < 10) {
      anomalies.push({
        audit_id: auditId,
        category: "trial_abuse",
        customer_id: customerId,
        status: "detected",
        confidence: "medium",
        annual_impact: 50, // Estimated lost revenue from proper conversion
        monthly_impact: 4.17,
        description: `Customer ${customerId} has ${succeededCharges.length} micro-charges totaling only $${totalCharged.toFixed(2)}. Possible trial/free tier abuse.`,
        root_cause: "Customer gaming free tier limits, creating multiple accounts, or unclear upgrade path.",
        recommendation: "Review account for multiple signups. Implement better trial limits. Improve upgrade conversion flow.",
        detected_at: now,
        metadata: { charges: succeededCharges.length, total: totalCharged },
      });
    }

    // 8. REVENUE LEAKAGE - High usage but low billing
    if (usageEvents.length > 0 && succeededCharges.length > 0) {
      const revenuePerUnit = totalCharged / totalUsage;
      if (totalUsage > 100 && revenuePerUnit < 0.001) {
        const expectedRevenue = totalUsage * 0.01; // Baseline expectation
        const leakage = expectedRevenue - totalCharged;
        if (leakage > 10) {
          anomalies.push({
            audit_id: auditId,
            category: "revenue_leakage",
            customer_id: customerId,
            status: "detected",
            confidence: leakage > 100 ? "high" : "medium",
            annual_impact: leakage * 12,
            monthly_impact: leakage,
            description: `Customer ${customerId} has ${totalUsage} usage units but only $${totalCharged.toFixed(2)} billed (~$${(revenuePerUnit * 1000).toFixed(3)}/1000 units). Potential leakage: $${leakage.toFixed(2)}/month.`,
            root_cause: "Pricing tier mismatch, grandfathered plan, discount applied incorrectly, or metering issue.",
            recommendation: "Review pricing configuration. Verify metering accuracy. Consider plan migration for underpriced accounts.",
            detected_at: now,
            metadata: { usage: totalUsage, billed: totalCharged, revenue_per_unit: revenuePerUnit, leakage },
          });
        }
      }
    }

    // 9. INVOLUNTARY CHURN RISK - Recent failures after success
    if (succeededCharges.length > 0 && failedCharges.length > 0) {
      const latestSuccess = Math.max(...succeededCharges.map((c) => Number(c.created) || 0));
      const latestFailure = Math.max(...failedCharges.map((c) => Number(c.created) || 0));
      if (latestFailure > latestSuccess) {
        anomalies.push({
          audit_id: auditId,
          category: "involuntary_churn",
          customer_id: customerId,
          status: "detected",
          confidence: "high",
          annual_impact: totalCharged * 12,
          monthly_impact: totalCharged,
          description: `Customer ${customerId} (worth $${totalCharged.toFixed(2)}/mo) has recent payment failure after previous successful payments. High churn risk.`,
          root_cause: "Payment method expired, card limits reached, or bank issues.",
          recommendation: "Urgent: Send payment update reminder. Implement Smart Retries. Consider offering payment pause option.",
          detected_at: now,
          metadata: { mrr: totalCharged, last_success: latestSuccess, last_failure: latestFailure },
        });
      }
    }
  }

  // Insert anomalies
  if (anomalies.length > 0) {
    const { error: insertError } = await adminSupabase.from("anomalies").insert(anomalies);
    if (insertError) {
      console.error("Failed to insert anomalies:", insertError);
      return NextResponse.json({ error: "Failed to save anomalies." }, { status: 500 });
    }
  }

  // Calculate totals
  const totalAnomalies = anomalies.length;
  const annualRevenueAtRisk = anomalies.reduce((sum, a) => sum + (a.annual_impact ?? 0), 0);

  // Determine date range
  let periodStart: string | null = null;
  let periodEnd: string | null = null;

  const allTimestamps: number[] = [];
  for (const row of usageRows) {
    const ts = new Date(row.timestamp).getTime();
    if (!isNaN(ts)) allTimestamps.push(ts);
  }
  for (const row of stripeRows) {
    const created = Number(row.created);
    if (!isNaN(created)) allTimestamps.push(created * 1000);
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

      const prompt = `You are a SaaS revenue analyst. Based on these detected anomalies, provide a brief executive summary (3-4 sentences) of the key revenue risks and top priority actions:

${JSON.stringify(anomalySummary, null, 2)}

Total anomalies: ${totalAnomalies}
Annual revenue at risk: $${annualRevenueAtRisk.toFixed(0)}

Be specific and actionable. Focus on the highest-impact items.`;

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
    columnMappings: {
      usage: usageMapping,
      stripe: stripeMapping,
    },
  });
}
