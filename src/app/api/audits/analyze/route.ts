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

  const { data: sessionData } = await serverSupabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  fetch(`${supabaseUrl}/functions/v1/analyze-audit`, {
    method: "POST",
    headers,
    body: JSON.stringify({ auditId, config }),
    keepalive: true,
  }).catch((error) => {
    console.error("Failed to invoke analyze-audit function:", error);
  });

  return NextResponse.json({
    success: true,
    status: "processing",
    message: "Analysis started. Check audit status for results.",
  });
}
