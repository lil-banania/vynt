import { ReactNode } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  LayoutGrid,
  Upload,
  Settings,
  LogOut,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";

type DashboardLayoutProps = {
  children: ReactNode;
};

const DashboardLayout = async ({ children }: DashboardLayoutProps) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();

  const userLabel =
    user.user_metadata?.full_name || user.email || "User";

  const signOut = async () => {
    "use server";
    const serverSupabase = await createClient();
    await serverSupabase.auth.signOut();
    redirect("/login");
  };

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <aside className="w-64 border-r border-slate-200 bg-white px-4 py-6">
        <div className="mb-8 text-xl font-semibold tracking-tight">
          Vynt
        </div>
        <nav className="space-y-1 text-sm">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-slate-700 transition hover:bg-slate-100"
          >
            <LayoutGrid className="h-4 w-4" />
            My Audits
          </Link>
          <Link
            href="/upload"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-slate-700 transition hover:bg-slate-100"
          >
            <Upload className="h-4 w-4" />
            New Audit
          </Link>
          <Link
            href="/settings"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-slate-700 transition hover:bg-slate-100"
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </nav>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <div className="text-sm text-slate-600">
            {userLabel}
          </div>
          <form action={signOut}>
            <Button
              variant="ghost"
              type="submit"
              className="text-slate-600 hover:text-slate-900"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </form>
        </header>
        <main className="flex-1 px-6 py-8">{children}</main>
      </div>
    </div>
  );
};

export default DashboardLayout;
