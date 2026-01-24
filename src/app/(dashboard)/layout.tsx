import { ReactNode } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BarChart3, Settings, LogOut, Plus } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { VyntLogo } from "@/components/ui/vynt-logo";
import { MobileNotSupported } from "@/components/layout/mobile-not-supported";
import { Toaster } from "sonner";

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

  const signOut = async () => {
    "use server";
    const serverSupabase = await createClient();
    await serverSupabase.auth.signOut();
    redirect("/login");
  };

  return (
    <>
      {/* Mobile not supported overlay */}
      <MobileNotSupported />

      <div className="hidden lg:flex min-h-screen bg-white text-slate-900">
        {/* Sidebar */}
        <aside className="fixed left-0 top-0 z-40 h-screen w-60 border-r border-slate-200 bg-white flex flex-col">
          {/* Logo */}
          <div className="px-4 py-8">
            <VyntLogo size="sm" />
          </div>

          {/* New Audit Button */}
          <div className="px-4 pb-4">
            <Button
              asChild
              className="w-full bg-orange-500 hover:bg-orange-600 text-white"
            >
              <Link href="/upload">
                <Plus className="h-4 w-4" />
                New audit
              </Link>
            </Button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4">
            <Link
              href="/dashboard"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-900 bg-slate-100 transition hover:bg-slate-100"
            >
              <BarChart3 className="h-4 w-4" />
              Audits
            </Link>
          </nav>

          {/* Bottom section */}
          <div className="mt-auto px-4 pb-6">
            <Separator className="mb-4" />
            <div className="space-y-1">
              <Link
                href="/settings"
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              >
                <Settings className="h-4 w-4" />
                Settings
              </Link>
              <form action={signOut}>
                <button
                  type="submit"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                >
                  <LogOut className="h-4 w-4" />
                  Log out
                </button>
              </form>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="ml-60 flex-1 min-h-screen">
          <div className="p-6">{children}</div>
        </main>
      </div>

      <Toaster position="bottom-right" richColors />
    </>
  );
};

export default DashboardLayout;
