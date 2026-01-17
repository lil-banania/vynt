"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import FileUploader from "@/components/upload/FileUploader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type UploadStep = "usage" | "stripe" | "review";

type AnalysisResult = {
  anomaliesDetected: number;
  annualRevenueAtRisk: number;
  aiInsights: string | null;
} | null;

const UploadPage = () => {
  const router = useRouter();
  const [auditId, setAuditId] = useState<string | null>(null);
  const [isCreatingAudit, setIsCreatingAudit] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [usageUploaded, setUsageUploaded] = useState(false);
  const [stripeUploaded, setStripeUploaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult>(null);

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
      // Run the automated analysis
      const response = await fetch("/api/audits/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditId }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error ?? "Analysis failed.");
      }

      setAnalysisResult({
        anomaliesDetected: data.anomaliesDetected ?? 0,
        annualRevenueAtRisk: data.annualRevenueAtRisk ?? 0,
        aiInsights: data.aiInsights ?? null,
      });
      setIsSubmitted(true);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to start analysis."
      );
    } finally {
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

  const formatCurrency = (value: number) => {
    return value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
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
                disabled={
                  !usageUploaded ||
                  !stripeUploaded ||
                  isSubmitting ||
                  isSubmitted
                }
              >
                {isSubmitting ? "Analyzing..." : "Start Analysis"}
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

      <Dialog
        open={isSubmitted}
        onOpenChange={(open) => {
          if (!open) {
            setIsSubmitted(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Analysis Complete</DialogTitle>
            <DialogDescription className="space-y-3 pt-2">
              <p>
                Your revenue audit has been analyzed automatically.
              </p>
              {analysisResult && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-slate-900">
                    <div className="grid gap-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-600">Anomalies detected:</span>
                        <span className="font-semibold">{analysisResult.anomaliesDetected}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">Annual revenue at risk:</span>
                        <span className="font-semibold text-rose-600">
                          {formatCurrency(analysisResult.annualRevenueAtRisk)}
                        </span>
                      </div>
                    </div>
                  </div>
                  {analysisResult.aiInsights && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                      <div className="mb-1 font-semibold">AI Analysis</div>
                      <p className="whitespace-pre-wrap">{analysisResult.aiInsights}</p>
                    </div>
                  )}
                </div>
              )}
              <p className="text-slate-500">
                Our team will review the findings and publish the full report within 3 business days.
              </p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push("/dashboard")}
            >
              Back to dashboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UploadPage;
