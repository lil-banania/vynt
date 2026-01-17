import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

import { createClient as createServerClient } from "@/lib/supabase/server";

export async function POST() {
  const serverSupabase = await createServerClient();
  const {
    data: { user },
    error: userError,
  } = await serverSupabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { error: "Unable to retrieve the user." },
      { status: 401 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing server configuration." },
      { status: 500 }
    );
  }

  const adminSupabase = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: profile, error: profileError } = await adminSupabase
    .from("profiles")
    .select("id, organization_id, full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json(
      { error: "Unable to retrieve your organization." },
      { status: 500 }
    );
  }

  let organizationId = profile?.organization_id ?? null;

  if (!organizationId) {
    if (!user.email) {
      return NextResponse.json(
        { error: "Unable to retrieve your organization." },
        { status: 400 }
      );
    }

    const fallbackName =
      (user.user_metadata as { company_name?: string } | undefined)?.company_name ||
      profile?.full_name ||
      (user.user_metadata as { full_name?: string } | undefined)?.full_name ||
      user.email.split("@")[0] ||
      "New Organization";

    const { data: organization, error: orgError } = await adminSupabase
      .from("organizations")
      .insert({ name: fallbackName })
      .select("id")
      .single();

    if (orgError || !organization) {
      return NextResponse.json(
        { error: "Unable to retrieve your organization." },
        { status: 500 }
      );
    }

    const { error: profileUpsertError } = await adminSupabase
      .from("profiles")
      .upsert({
        id: user.id,
        email: user.email,
        full_name: profile?.full_name ?? user.user_metadata?.full_name ?? null,
        organization_id: organization.id,
        role: "member",
      });

    if (profileUpsertError) {
      return NextResponse.json(
        { error: "Unable to retrieve your organization." },
        { status: 500 }
      );
    }

    organizationId = organization.id;
  }

  const { data: audit, error: auditError } = await adminSupabase
    .from("audits")
    .insert({
      status: "pending",
      created_by: user.id,
      organization_id: organizationId,
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (auditError || !audit) {
    return NextResponse.json(
      { error: "Unable to create the audit." },
      { status: 500 }
    );
  }

  return NextResponse.json({ auditId: audit.id });
}
