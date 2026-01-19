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
  if (audit.is_chunked && audit.status === "processing" && (audit.chunks_completed ?? 0) < (audit.chunks_total ?? 1)) {
    // Check if there are pending chunks
    const { count: pendingCount } = await adminSupabase
      .from("analysis_queue")
      .select("*", { count: "exact", head: true })
      .eq("audit_id", auditId)
      .eq("status", "pending");

    if (pendingCount && pendingCount > 0) {
      // Trigger chunk processing
      const edgeFunctionUrl = `${supabaseUrl}/functions/v1/process-chunk`;
      fetch(edgeFunctionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ trigger: "poll" }),
      }).catch((err) => console.error("[poll] Failed to trigger process-chunk:", err));
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
