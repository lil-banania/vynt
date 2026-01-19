"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

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

type AnalysisStatus = "idle" | "processing" | "review" | "error";

const UploadPage = () => {
  const router = useRouter();
  const [auditId, setAuditId] = useState<string | null>(null);
  const [isCreatingAudit, setIsCreatingAudit] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [usageUploaded, setUsageUploaded] = useState(false);
  const [stripeUploaded, setStripeUploaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>("idle");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult>(null);
  const [showResultDialog, setShowResultDialog] = useState(false);
  const [progress, setProgress] = useState(0);

  const createAuditInFlight = useRef<Promise<string> | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      if (pollingTimeoutRef.current) clearTimeout(pollingTimeoutRef.current);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, []);

  const ensureAudit = async () => {
    if (auditId) return auditId;
    if (createAuditInFlight.current) return createAuditInFlight.current;

    setIsCreatingAudit(true);
    setErrorMessage(null);

    const promise = (async () => {
      const response = await fetch("/api/audits/create", { method: "POST" });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.auditId) {
        throw new Error(data?.error ?? "An error occurred while creating the audit.");
      }

      setAuditId(data.auditId);
      return data.auditId as string;
    })();

    createAuditInFlight.current = promise;

    try {
      return await promise;
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "An error occurred while creating the audit."
      );
      throw error;
    } finally {
      createAuditInFlight.current = null;
      setIsCreatingAudit(false);
    }
  };

  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  };

  const handleStartAnalysis = async () => {
    if (!auditId || !usageUploaded || !stripeUploaded) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    setAnalysisStatus("processing");
    setProgress(0);

    try {
      const response = await fetch("/api/audits/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditId }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        let errorMsg = data?.error ?? "Analysis failed.";
        if (data?.details) errorMsg += ` Details: ${data.details}`;
        throw new Error(errorMsg);
      }

      // Start progress animation
      progressIntervalRef.current = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) return prev;
          return prev + Math.random() * 3;
        });
      }, 500);

      // Start polling for results
      const pollAuditStatus = async () => {
        if (!auditId) return;
        
        try {
          const pollResponse = await fetch("/api/audits/poll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ auditId }),
          });

          const pollData = await pollResponse.json().catch(() => null);

          if (!pollResponse.ok || !pollData) {
            console.error("Poll error:", pollData);
            return; // Don't stop polling on transient errors
          }

          // Update progress from actual chunk completion if available
          if (pollData.isChunked && pollData.progress !== null) {
            setProgress(pollData.progress);
          }

          if (pollData.status === "review" || pollData.status === "published") {
            stopPolling();
            setProgress(100);
            setAnalysisResult({
              anomaliesDetected: pollData.totalAnomalies ?? 0,
              annualRevenueAtRisk: pollData.annualRevenueAtRisk ?? 0,
              aiInsights: pollData.aiInsights ?? null,
            });
            setAnalysisStatus("review");
            setIsSubmitting(false);
            setShowResultDialog(true);
            return;
          }

          if (pollData.status === "error") {
            stopPolling();
            setAnalysisStatus("error");
            setErrorMessage(pollData.errorMessage ?? "Analysis failed.");
            setIsSubmitting(false);
            return;
          }
        } catch (e) {
          console.error("Polling error:", e);
        }
      };

      // Poll immediately, then every 3 seconds
      await pollAuditStatus();
      pollingIntervalRef.current = setInterval(pollAuditStatus, 3000);

      // Timeout after 10 minutes for large files
      pollingTimeoutRef.current = setTimeout(() => {
        stopPolling();
        setAnalysisStatus("error");
        setErrorMessage("Analysis is taking longer than expected. Please check back later.");
        setIsSubmitting(false);
      }, 10 * 60 * 1000);

    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to start analysis.");
      setAnalysisStatus("error");
      setIsSubmitting(false);
    }
  };

  const currentStep: UploadStep = usageUploaded
    ? stripeUploaded
      ? "review"
      : "stripe"
    : "usage";

  const stepBadgeVariant = (step: UploadStep) => {
    if (step === currentStep) return "default";
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
        <h1 className="text-2xl font-semibold text-slate-900">New Revenue Audit</h1>
        <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-700">
          <Badge variant={stepBadgeVariant("usage")}>1. Upload Usage Logs</Badge>
          <Badge variant={stepBadgeVariant("stripe")}>2. Upload Stripe Export</Badge>
          <Badge variant={stepBadgeVariant("review")}>3. Review &amp; Submit</Badge>
        </div>
      </div>

      {errorMessage && (
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="py-4 text-sm text-rose-700">{errorMessage}</CardContent>
        </Card>
      )}

      {isCreatingAudit && (
        <Card className="border-slate-200">
          <CardContent className="py-6 text-sm text-slate-600">Creating the audit...</CardContent>
        </Card>
      )}

      {!isCreatingAudit && (
        <>
          <Card className="border-slate-200 bg-white">
            <CardHeader>
              <CardTitle className="text-base font-semibold">Review &amp; Submit</CardTitle>
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
                    Analyzing... {Math.round(progress)}%
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
                <CardTitle className="text-base font-semibold">Usage Logs</CardTitle>
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
                <CardTitle className="text-base font-semibold">Stripe Export</CardTitle>
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

      {/* Results Dialog */}
      <Dialog open={showResultDialog} onOpenChange={(open) => {
        if (!open) router.push("/dashboard");
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              Analysis Complete
            </DialogTitle>
            <DialogDescription className="space-y-4 pt-4">
              <p className="text-slate-600">
                Your revenue audit has been analyzed. Here are the key findings:
              </p>
              
              {analysisResult && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center">
                      <div className="text-3xl font-bold text-slate-900">
                        {analysisResult.anomaliesDetected}
                      </div>
                      <div className="text-sm text-slate-600">Anomalies Detected</div>
                    </div>
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-center">
                      <div className="text-3xl font-bold text-rose-600">
                        {formatCurrency(analysisResult.annualRevenueAtRisk)}
                      </div>
                      <div className="text-sm text-rose-700">Revenue at Risk</div>
                    </div>
                  </div>

                  {analysisResult.aiInsights && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                      <div className="mb-2 flex items-center gap-2 font-semibold text-blue-900">
                        <AlertTriangle className="h-4 w-4" />
                        AI Summary
                      </div>
                      <p className="text-sm text-blue-800 whitespace-pre-wrap">
                        {analysisResult.aiInsights}
                      </p>
                    </div>
                  )}

                  <p className="text-sm text-slate-500 text-center pt-2">
                    Our team will review your audit and contact you within 48 hours.
                  </p>
                </div>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button className="w-full" onClick={() => router.push("/dashboard")}>
              Back to Dashboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UploadPage;
