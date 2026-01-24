"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ExportAuditButton() {
  const handleExport = () => {
    window.print();
  };

  return (
    <Button variant="outline" onClick={handleExport}>
      <Download className="h-4 w-4" />
      Export audit
    </Button>
  );
}
