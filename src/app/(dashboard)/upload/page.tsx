"use client";

import { useEffect, useMemo, useState } from "react";
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
import { createClient } from "@/lib/supabase/client";

type UploadStep = "usage" | "stripe" | "review";

const UploadPage = () => {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [auditId, setAuditId] = useState<string | null>(null);
  const [isCreatingAudit, setIsCreatingAudit] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [usageUploaded, setUsageUploaded] = useState(false);
  const [stripeUploaded, setStripeUploaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const createAudit = async () => {
      try {
        const response = await fetch("/api/audits/create", {
          method: "POST",
        });
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(
            data?.error ??
              "An error occurred while creating the audit."
          );
        }

        if (isMounted) {
          setAuditId(data?.auditId ?? null);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "An error occurred while creating the audit."
          );
        }
      } finally {
        if (isMounted) {
          setIsCreatingAudit(false);
        }
      }
    };

    createAudit();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleStartAnalysis = async () => {
    if (!auditId || !usageUploaded || !stripeUploaded) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const { error } = await supabase
      .from("audits")
      .update({ status: "processing" })
      .eq("id", auditId);

    if (error) {
      setErrorMessage("Unable to start analysis.");
      setIsSubmitting(false);
      return;
    }

    setIsSubmitted(true);
    setIsSubmitting(false);
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

      {!isCreatingAudit && auditId && (
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
                  ? "Both files are ready."
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
                {isSubmitting ? "Starting..." : "Start Analysis"}
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
            <DialogTitle>Analysis started</DialogTitle>
            <DialogDescription>
              We will get back to you within 3 days with the results.
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