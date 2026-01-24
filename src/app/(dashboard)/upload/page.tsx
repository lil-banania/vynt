"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { X, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { VyntLogo } from "@/components/ui/vynt-logo";
import { Dropzone } from "@/components/upload/Dropzone";
import { Separator } from "@/components/ui/separator";

const UploadPage = () => {
  const router = useRouter();
  const [auditId, setAuditId] = useState<string | null>(null);
  const [usageUploaded, setUsageUploaded] = useState(false);
  const [stripeUploaded, setStripeUploaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);

  const createAuditInFlight = useRef<Promise<string> | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    } finally {
      createAuditInFlight.current = null;
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

      // Poll for results
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
            return;
          }

          if (pollData.isChunked && pollData.progress !== null) {
            setProgress(pollData.progress);
          }

          if (pollData.status === "review" || pollData.status === "published") {
            stopPolling();
            setProgress(100);
            setIsSubmitting(false);
            toast.success("Audit submitted successfully!", {
              description: "Your revenue audit has been queued for analysis.",
            });
            router.push("/dashboard");
            return;
          }

          if (pollData.status === "error") {
            stopPolling();
            toast.error("Analysis failed", {
              description: pollData.errorMessage ?? "Please try again.",
            });
            setIsSubmitting(false);
            return;
          }
        } catch (e) {
          console.error("Polling error:", e);
        }
      };

      await pollAuditStatus();
      pollingIntervalRef.current = setInterval(pollAuditStatus, 3000);

      pollingTimeoutRef.current = setTimeout(() => {
        stopPolling();
        toast.error("Analysis timeout", {
          description: "Analysis is taking longer than expected. Please check back later.",
        });
        setIsSubmitting(false);
      }, 10 * 60 * 1000);
    } catch (error) {
      toast.error("Error", {
        description: error instanceof Error ? error.message : "Unable to start analysis.",
      });
      setIsSubmitting(false);
    }
  };

  const canSubmit = usageUploaded && stripeUploaded && !isSubmitting;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-200 px-8 py-6">
        <VyntLogo size="md" />
        <h1 className="text-xl font-medium text-slate-900">Revenue audit</h1>
        <Button variant="outline" asChild>
          <Link href="/dashboard">
            <X className="h-4 w-4" />
            Close
          </Link>
        </Button>
      </header>

      {/* Content */}
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-3xl">
          {/* Upload Cards */}
          <div className="flex rounded-xl border border-slate-200 bg-white">
            {/* Step 1 */}
            <div className="flex-1 p-6">
              <div className="mb-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  STEP 1
                </span>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">
                  Transactions CSV
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Export from your product, database, or billing system.
                </p>
              </div>
              <Dropzone
                auditId={auditId}
                onEnsureAudit={ensureAudit}
                fileType="usage_logs"
                onUploadComplete={() => setUsageUploaded(true)}
              />
            </div>

            {/* Separator */}
            <Separator orientation="vertical" className="h-auto" />

            {/* Step 2 */}
            <div className="flex-1 p-6">
              <div className="mb-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  STEP 2
                </span>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">
                  Stripe CSV export
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Export from Stripe to compare charges and payouts.
                </p>
              </div>
              <Dropzone
                auditId={auditId}
                onEnsureAudit={ensureAudit}
                fileType="stripe_export"
                onUploadComplete={() => setStripeUploaded(true)}
              />
            </div>
          </div>

          {/* Submit Button */}
          <div className="mt-8 flex justify-center">
            <Button
              size="lg"
              className="bg-orange-500 hover:bg-orange-600 text-white px-8"
              onClick={handleStartAnalysis}
              disabled={!canSubmit}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyzing... {Math.round(progress)}%
                </>
              ) : (
                <>
                  Run audit
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UploadPage;
