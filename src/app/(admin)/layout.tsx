import { ReactNode } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ClipboardList,
  Eye,
  LogOut,
  CheckCircle,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";

type AdminLayoutProps = {
  children: ReactNode;
};

const AdminLayout = async ({ children }: AdminLayoutProps) => {
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

  const isAdmin = profile?.role === "vynt_admin";

  if (!isAdmin) {
    redirect("/dashboard");
  }

  const userLabel =
    user.user_metadata?.full_name || user.email || "Admin";

  const signOut = async () => {
    "use server";
    const serverSupabase = await createClient();
    await serverSupabase.auth.signOut();
    redirect("/login");
  };

  return (
    <div className="flex min-h-screen bg-slate-900 text-slate-100">
      <aside className="w-64 border-r border-slate-800 bg-slate-950 px-4 py-6">
        <div className="mb-2 text-xl font-semibold tracking-tight text-white">
          Vynt
        </div>
        <div className="mb-8 text-xs font-medium uppercase tracking-wider text-amber-500">
          Admin Console
        </div>
        <nav className="space-y-1 text-sm">
          <Link
            href="/admin"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-slate-300 transition hover:bg-slate-800 hover:text-white"
          >
            <ClipboardList className="h-4 w-4" />
            All Audits
          </Link>
          <Link
            href="/admin?status=pending"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-slate-300 transition hover:bg-slate-800 hover:text-white"
          >
            <Eye className="h-4 w-4" />
            Pending Review
          </Link>
          <Link
            href="/admin?status=review"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-slate-300 transition hover:bg-slate-800 hover:text-white"
          >
            <CheckCircle className="h-4 w-4" />
            Ready to Publish
          </Link>
        </nav>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-6 py-4">
          <div className="flex items-center gap-3 text-sm text-slate-400">
            <span>{userLabel}</span>
            <span className="rounded bg-amber-600 px-2 py-0.5 text-xs font-medium text-white">
              Admin
            </span>
          </div>
          <form action={signOut}>
            <Button
              variant="ghost"
              type="submit"
              className="text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </form>
        </header>
        <main className="flex-1 bg-slate-900 px-6 py-8">{children}</main>
      </div>
    </div>
  );
};

export default AdminLayout;
