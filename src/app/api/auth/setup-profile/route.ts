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
      { error: "Unable to retrieve user." },
      { status: 401 }
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

  const { data: existingProfile } = await adminSupabase
    .from("profiles")
    .select("id, organization_id")
    .eq("id", user.id)
    .maybeSingle();

  if (existingProfile?.organization_id) {
    return NextResponse.json({ success: true, alreadySetup: true });
  }

  const companyName =
    (user.user_metadata as { company_name?: string } | undefined)?.company_name ??
    (user.user_metadata as { full_name?: string } | undefined)?.full_name ??
    user.email?.split("@")[0] ??
    "New Organization";

  const { data: organization, error: orgError } = await adminSupabase
    .from("organizations")
    .insert({ name: companyName })
    .select("id")
    .single();

  if (orgError || !organization) {
    return NextResponse.json(
      { error: "Unable to create organization." },
      { status: 500 }
    );
  }

  const { error: profileError } = await adminSupabase
    .from("profiles")
    .upsert({
      id: user.id,
      email: user.email,
      full_name:
        (user.user_metadata as { full_name?: string } | undefined)?.full_name ?? null,
      organization_id: organization.id,
      role: "member",
    });

  if (profileError) {
    return NextResponse.json(
      { error: "Unable to create profile." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
