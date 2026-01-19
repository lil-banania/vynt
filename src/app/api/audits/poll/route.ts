import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

import { createClient as createServerClient } from "@/lib/supabase/server";

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

  const { data: audit, error: auditError } = await adminSupabase
    .from("audits")
    .select("status, total_anomalies, annual_revenue_at_risk, error_message, ai_insights, is_chunked, chunks_completed, chunks_total")
    .eq("id", auditId)
    .maybeSingle();

  if (auditError || !audit) {
    return NextResponse.json({ error: "Audit not found." }, { status: 404 });
  }

  // For chunked audits that are still processing, trigger next chunk
  if (audit.is_chunked && audit.status === "processing") {
    // Check for stuck chunks (processing for > 2 minutes) and reset them
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    await adminSupabase
      .from("analysis_queue")
      .update({ status: "pending", started_at: null })
      .eq("audit_id", auditId)
      .eq("status", "processing")
      .lt("started_at", twoMinutesAgo);

    // Check if there are pending chunks
    const { count: pendingCount } = await adminSupabase
      .from("analysis_queue")
      .select("*", { count: "exact", head: true })
      .eq("audit_id", auditId)
      .eq("status", "pending");

    if (pendingCount && pendingCount > 0) {
      console.log(`[poll] ${pendingCount} pending chunks for audit ${auditId}, triggering process-chunk`);
      // Trigger chunk processing
      const edgeFunctionUrl = `${supabaseUrl}/functions/v1/process-chunk`;
      fetch(edgeFunctionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ trigger: "poll", auditId }),
      }).catch((err) => console.error("[poll] Failed to trigger process-chunk:", err));
    } else {
      // No pending chunks but audit still processing - check if all chunks completed
      const { count: completedCount } = await adminSupabase
        .from("analysis_queue")
        .select("*", { count: "exact", head: true })
        .eq("audit_id", auditId)
        .eq("status", "completed");

      if (completedCount && completedCount >= (audit.chunks_total ?? 0)) {
        // All chunks completed but audit not finalized - finalize now
        console.log(`[poll] All ${completedCount} chunks completed, finalizing audit ${auditId}`);
        
        const { count: anomalyCount } = await adminSupabase
          .from("anomalies")
          .select("*", { count: "exact", head: true })
          .eq("audit_id", auditId);

        const { data: allAnomalies } = await adminSupabase
          .from("anomalies")
          .select("annual_impact")
          .eq("audit_id", auditId);

        const annualRevenueAtRisk = allAnomalies?.reduce((sum, a) => sum + (a.annual_impact ?? 0), 0) ?? 0;

        await adminSupabase
          .from("audits")
          .update({
            status: "review",
            chunks_completed: completedCount,
            total_anomalies: anomalyCount ?? 0,
            annual_revenue_at_risk: annualRevenueAtRisk,
            processed_at: new Date().toISOString(),
            ai_insights: `Analysis completed. Found ${anomalyCount ?? 0} potential revenue issues totaling $${annualRevenueAtRisk.toFixed(2)} annually at risk.`,
          })
          .eq("id", auditId);
      }
    }
  }

  // Calculate progress percentage for chunked audits
  let progress = null;
  if (audit.is_chunked && audit.chunks_total && audit.chunks_total > 0) {
    progress = Math.round(((audit.chunks_completed ?? 0) / audit.chunks_total) * 100);
  }

  return NextResponse.json({
    status: audit.status,
    totalAnomalies: audit.total_anomalies ?? 0,
    annualRevenueAtRisk: audit.annual_revenue_at_risk ?? 0,
    errorMessage: audit.error_message ?? null,
    aiInsights: audit.ai_insights ?? null,
    isChunked: audit.is_chunked ?? false,
    chunksCompleted: audit.chunks_completed ?? 0,
    chunksTotal: audit.chunks_total ?? 0,
    progress,
  });
}
