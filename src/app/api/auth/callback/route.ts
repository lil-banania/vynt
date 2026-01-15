import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const GET = async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=auth", request.url)
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL("/login?error=auth", request.url)
    );
  }

  return NextResponse.redirect(new URL("/dashboard", request.url));
};