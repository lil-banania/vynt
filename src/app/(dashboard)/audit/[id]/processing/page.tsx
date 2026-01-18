"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

type ProcessingPageProps = {
  params: Promise<{
    id: string;
  }>;
};

type AuditStatus = "idle" | "processing" | "review" | "published" | "error";

export default function AuditProcessingPage({ params }: ProcessingPageProps) {
  const router = useRouter();
  const [auditId, setAuditId] = useState<string | null>(null);
  const [status, setStatus] = useState<AuditStatus>("processing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    params.then((p) => setAuditId(p.id));
  }, [params]);

  useEffect(() => {
    if (!auditId) return;

    let interval: ReturnType<typeof setInterval>;
    let progressInterval: ReturnType<typeof setInterval>;
    let timeoutTimer: ReturnType<typeof setTimeout>;

    const pollStatus = async () => {
      try {
        const response = await fetch("/api/audits/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auditId }),
        });

        if (!response.ok) {
          throw new Error("Failed to fetch audit status");
        }

        const data = await response.json();
        setStatus(data.status);

        if (data.status === "review" || data.status === "published") {
          clearInterval(interval);
          clearInterval(progressInterval);
          clearTimeout(timeoutTimer);
          setProgress(100);

          setTimeout(() => {
            router.push(`/audit/${auditId}`);
            router.refresh();
          }, 1000);
        } else if (data.status === "error") {
          clearInterval(interval);
          clearInterval(progressInterval);
          clearTimeout(timeoutTimer);
          setErrorMessage(
            data.errorMessage || "Analysis failed. Please try again."
          );
        }
      } catch (error) {
        console.error("Polling error:", error);
      }
    };

    pollStatus();
    interval = setInterval(pollStatus, 2000);

    progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) return prev;
        return prev + Math.random() * 5;
      });
    }, 500);

    timeoutTimer = setTimeout(() => {
      clearInterval(interval);
      clearInterval(progressInterval);
      setStatus("error");
      setErrorMessage(
        "Analysis is taking longer than expected. Please refresh the page or contact support."
      );
    }, 300000);

    return () => {
      clearInterval(interval);
      clearInterval(progressInterval);
      clearTimeout(timeoutTimer);
    };
  }, [auditId, router]);

  if (status === "error") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
          <div className="mb-6">
            <div className="mx-auto w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center">
              <XCircle className="h-8 w-8 text-rose-600" />
            </div>
          </div>

          <h1 className="text-2xl font-bold text-slate-900 mb-3">
            Analysis Failed
          </h1>

          <p className="text-slate-600 mb-6">{errorMessage}</p>

          <div className="flex gap-3 justify-center">
            <button
              onClick={() => router.push("/dashboard")}
              className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
            >
              Back to Dashboard
            </button>
            <button
              onClick={() => router.push("/upload")}
              className="px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === "review" || status === "published") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
          <div className="mb-6">
            <div className="mx-auto w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            </div>
          </div>

          <h1 className="text-2xl font-bold text-slate-900 mb-3">
            Analysis Complete!
          </h1>

          <p className="text-slate-600">Redirecting to your results...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
        <div className="mb-6">
          <div className="mx-auto w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
            <Loader2 className="h-8 w-8 text-slate-900 animate-spin" />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-slate-900 mb-3">
          Analyzing Your Revenue Data
        </h1>

        <p className="text-slate-600 mb-6">
          This usually takes 30-90 seconds. We&apos;re cross-referencing your
          billing records with usage data to detect anomalies.
        </p>

        <div className="w-full bg-slate-100 rounded-full h-2 mb-3">
          <div
            className="bg-slate-900 h-2 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>

        <p className="text-sm text-slate-500">{Math.round(progress)}% complete</p>

        <div className="mt-8 pt-6 border-t border-slate-200">
          <p className="text-xs text-slate-400">
            Please don&apos;t close this window. The analysis is running in the
            background.
          </p>
        </div>
      </div>
    </div>
  );
}
