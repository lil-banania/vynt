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

  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "vynt_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

  // Check if audit is published
  const { data: audit } = await adminSupabase
    .from("audits")
    .select("id, status")
    .eq("id", auditId)
    .single();

  if (!audit) {
    return NextResponse.json({ error: "Audit not found." }, { status: 404 });
  }

  if (audit.status === "published") {
    return NextResponse.json({ error: "Cannot delete published audits." }, { status: 400 });
  }

  // Delete related anomalies
  await adminSupabase.from("anomalies").delete().eq("audit_id", auditId);

  // Delete uploaded files records (storage files will remain)
  await adminSupabase.from("uploaded_files").delete().eq("audit_id", auditId);

  // Delete the audit
  const { error: deleteError } = await adminSupabase
    .from("audits")
    .delete()
    .eq("id", auditId);

  if (deleteError) {
    return NextResponse.json({ error: "Failed to delete audit." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
