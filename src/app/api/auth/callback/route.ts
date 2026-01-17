import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

export const GET = async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=auth", request.url));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL("/login?error=auth", request.url));
  }

  const user = data.user;
  let userRole = "member";

  if (user) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

    if (supabaseUrl && serviceRoleKey) {
      const adminSupabase = createAdminClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: existingProfile } = await adminSupabase
        .from("profiles")
        .select("id, organization_id, role")
        .eq("id", user.id)
        .maybeSingle();

      if (existingProfile?.role) {
        userRole = existingProfile.role;
      }

      if (!existingProfile?.organization_id) {
        const companyName =
          (user.user_metadata as { company_name?: string } | undefined)?.company_name ??
          (user.user_metadata as { full_name?: string } | undefined)?.full_name ??
          user.email?.split("@")[0] ??
          "New Organization";

        const { data: organization } = await adminSupabase
          .from("organizations")
          .insert({ name: companyName })
          .select("id")
          .single();

        if (organization) {
          await adminSupabase.from("profiles").upsert({
            id: user.id,
            email: user.email,
            full_name:
              (user.user_metadata as { full_name?: string } | undefined)?.full_name ?? null,
            organization_id: organization.id,
            role: existingProfile?.role ?? "member",
          });
        }
      }
    }
  }

  // Redirect based on role
  const redirectUrl = userRole === "vynt_admin" ? "/admin" : "/dashboard";

  return NextResponse.redirect(new URL(redirectUrl, request.url));
};
