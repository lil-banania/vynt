"use client";

import { Button } from "@/components/ui/button";

const ExportPdfButton = () => {
  const handleExport = () => {
    window.print();
  };

  return (
    <Button type="button" variant="outline" onClick={handleExport}>
      Export PDF
    </Button>
  );
};

export default ExportPdfButton;
