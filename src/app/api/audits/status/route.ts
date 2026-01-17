import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

import { createClient as createServerClient } from "@/lib/supabase/server";

const VALID_STATUSES = new Set([
  "pending",
  "processing",
  "review",
  "published",
]);

export async function POST(request: Request) {
  const serverSupabase = await createServerClient();
  const {
    data: { user },
    error: userError,
  } = await serverSupabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "vynt_admin") {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const auditId = body?.auditId;
  const status = body?.status;

  if (!auditId || typeof auditId !== "string") {
    return NextResponse.json(
      { error: "Audit ID is required." },
      { status: 400 }
    );
  }

  if (!status || typeof status !== "string" || !VALID_STATUSES.has(status)) {
    return NextResponse.json(
      { error: "Invalid status." },
      { status: 400 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Server configuration missing." },
      { status: 500 }
    );
  }

  const adminSupabase = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const updateData: { status: string; published_at?: string } = { status };

  if (status === "published") {
    updateData.published_at = new Date().toISOString();
  }

  const { error: updateError } = await adminSupabase
    .from("audits")
    .update(updateData)
    .eq("id", auditId);

  if (updateError) {
    return NextResponse.json(
      { error: "Failed to update audit status." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
