"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import FileUploader from "@/components/upload/FileUploader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type UploadStep = "usage" | "stripe" | "review";

const UploadPage = () => {
  const router = useRouter();
  const [auditId, setAuditId] = useState<string | null>(null);
  const [isCreatingAudit, setIsCreatingAudit] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [usageUploaded, setUsageUploaded] = useState(false);
  const [stripeUploaded, setStripeUploaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const createAuditInFlight = useRef<Promise<string> | null>(null);

  const ensureAudit = async () => {
    if (auditId) {
      return auditId;
    }

    if (createAuditInFlight.current) {
      return createAuditInFlight.current;
    }

    setIsCreatingAudit(true);
    setErrorMessage(null);

    const promise = (async () => {
      const response = await fetch("/api/audits/create", {
        method: "POST",
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.auditId) {
        throw new Error(
          data?.error ?? "An error occurred while creating the audit."
        );
      }

      setAuditId(data.auditId);
      return data.auditId as string;
    })();

    createAuditInFlight.current = promise;

    try {
      return await promise;
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "An error occurred while creating the audit."
      );
      throw error;
    } finally {
      createAuditInFlight.current = null;
      setIsCreatingAudit(false);
    }
  };

  const handleStartAnalysis = async () => {
    if (!auditId || !usageUploaded || !stripeUploaded) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/audits/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditId }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        let errorMsg = data?.error ?? "Analysis failed.";
        if (data?.details) {
          errorMsg += ` Details: ${data.details}`;
        }
        throw new Error(errorMsg);
      }

      // Redirect to processing page
      router.push(`/audit/${auditId}/processing`);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to start analysis."
      );
      setIsSubmitting(false);
    }
  };

  const currentStep: UploadStep = usageUploaded
    ? stripeUploaded
      ? "review"
      : "stripe"
    : "usage";

  const stepBadgeVariant = (step: UploadStep) => {
    if (step === currentStep) {
      return "default";
    }
    if (
      (step === "usage" && usageUploaded) ||
      (step === "stripe" && stripeUploaded) ||
      (step === "review" && usageUploaded && stripeUploaded)
    ) {
      return "secondary";
    }
    return "outline";
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          New Revenue Audit
        </h1>
        <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-700">
          <Badge variant={stepBadgeVariant("usage")}>
            1. Upload Usage Logs
          </Badge>
          <Badge variant={stepBadgeVariant("stripe")}>
            2. Upload Stripe Export
          </Badge>
          <Badge variant={stepBadgeVariant("review")}>
            3. Review &amp; Submit
          </Badge>
        </div>
      </div>

      {errorMessage && (
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="py-4 text-sm text-rose-700">
            {errorMessage}
          </CardContent>
        </Card>
      )}

      {isCreatingAudit && (
        <Card className="border-slate-200">
          <CardContent className="py-6 text-sm text-slate-600">
            Creating the audit...
          </CardContent>
        </Card>
      )}

      {!isCreatingAudit && (
        <>
          <Card className="border-slate-200 bg-white">
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                Review &amp; Submit
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-600">
                {usageUploaded && stripeUploaded
                  ? "Both files are ready. Click to run automated analysis."
                  : "Please upload both files to continue."}
              </div>
              <Button
                type="button"
                size="lg"
                className="w-full sm:w-auto"
                onClick={handleStartAnalysis}
                disabled={!usageUploaded || !stripeUploaded || isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Starting Analysis...
                  </>
                ) : (
                  "Start Analysis"
                )}
              </Button>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="border-slate-200">
              <CardHeader className="pb-4">
                <CardTitle className="text-base font-semibold">
                  Usage Logs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <FileUploader
                  auditId={auditId}
                  onEnsureAudit={ensureAudit}
                  fileType="usage_logs"
                  onUploadComplete={() => setUsageUploaded(true)}
                />
              </CardContent>
            </Card>

            <Card className="border-slate-200">
              <CardHeader className="pb-4">
                <CardTitle className="text-base font-semibold">
                  Stripe Export
                </CardTitle>
              </CardHeader>
              <CardContent>
                <FileUploader
                  auditId={auditId}
                  onEnsureAudit={ensureAudit}
                  fileType="stripe_export"
                  onUploadComplete={() => setStripeUploaded(true)}
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};

export default UploadPage;
