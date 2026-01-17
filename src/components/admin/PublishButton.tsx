"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

type PublishButtonProps = {
  auditId: string;
  status: string;
};

const PublishButton = ({ auditId, status }: PublishButtonProps) => {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePublish = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/audits/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditId, status: "published" }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.error ?? "Failed to publish audit.");
        return;
      }

      router.push("/admin");
      router.refresh();
    } catch {
      setError("Failed to publish audit. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (status === "published") {
    return null;
  }

  return (
    <div className="flex items-center gap-3">
      {error && (
        <span className="text-sm text-rose-400">{error}</span>
      )}
      <Button
        onClick={handlePublish}
        disabled={isLoading}
        className="bg-emerald-600 hover:bg-emerald-700"
      >
        {isLoading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Check className="mr-2 h-4 w-4" />
        )}
        Publish Audit
      </Button>
    </div>
  );
};

export default PublishButton;
