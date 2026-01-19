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
  const config = body?.config;

  if (!auditId || typeof auditId !== "string") {
    return NextResponse.json({ error: "Audit ID is required." }, { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Server configuration missing." }, { status: 500 });
  }

  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("organization_id")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.organization_id) {
    return NextResponse.json({ error: "Unable to retrieve your organization." }, { status: 403 });
  }

  const adminSupabase = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: auditMeta, error: auditMetaError } = await adminSupabase
    .from("audits")
    .select("id, organization_id")
    .eq("id", auditId)
    .maybeSingle();

  if (auditMetaError || !auditMeta) {
    return NextResponse.json({ error: "Audit not found." }, { status: 404 });
  }

  if (auditMeta.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await adminSupabase
    .from("audits")
    .update({ status: "processing", error_message: null })
    .eq("id", auditId);

  // Call Edge Function in fire-and-forget mode (don't await full completion)
  // The Edge Function will update the audit status when done
  const edgeFunctionUrl = `${supabaseUrl}/functions/v1/analyze-audit`;
  console.log("[analyze] Triggering Edge Function:", edgeFunctionUrl);

  // Fire and forget - don't await the full response
  fetch(edgeFunctionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ auditId, config }),
  })
    .then(async (response) => {
      if (!response.ok) {
        const responseText = await response.text().catch(() => "Unknown error");
        console.error("[analyze] Edge Function error:", response.status, responseText);
        // Update audit status to error
        await adminSupabase
          .from("audits")
          .update({
            status: "error",
            error_message: `Edge Function error: ${response.status} - ${responseText}`,
          })
          .eq("id", auditId);
      } else {
        console.log("[analyze] Edge Function completed successfully");
      }
    })
    .catch(async (error) => {
      console.error("[analyze] Failed to invoke Edge Function:", error);
      await adminSupabase
        .from("audits")
        .update({
          status: "error",
          error_message: `Failed to call Edge Function: ${error instanceof Error ? error.message : "Unknown error"}`,
        })
        .eq("id", auditId);
    });

  // Return immediately - the Edge Function will update the audit when done
  return NextResponse.json({
    success: true,
    status: "processing",
    message: "Analysis started. Check audit status for results.",
  });
}
