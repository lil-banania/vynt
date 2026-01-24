"use client";

import { Monitor } from "lucide-react";
import { VyntLogo } from "@/components/ui/vynt-logo";

export function MobileNotSupported() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white p-8 lg:hidden">
      <VyntLogo size="md" className="mb-8" />
      
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-100 mb-6">
        <Monitor className="h-10 w-10 text-slate-600" />
      </div>
      
      <h1 className="text-xl font-semibold text-slate-900 text-center mb-2">
        Desktop Only
      </h1>
      
      <p className="text-sm text-slate-600 text-center max-w-xs">
        Vynt is optimized for desktop viewing. Please open this page on a larger screen for the best experience.
      </p>
      
      <div className="mt-8 flex items-center gap-2 text-xs text-slate-400">
        <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
        Mobile version coming soon
      </div>
    </div>
  );
}
