"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import FileUploader from "@/components/upload/FileUploader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          throw new Error("Impossible de récupérer l'utilisateur.");
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("organization_id, full_name")
          .eq("id", user.id)
          .maybeSingle();

        let organizationId = profile?.organization_id ?? null;

        if (!organizationId) {
          if (!user.email) {
            throw new Error("Impossible de récupérer votre organisation.");
          }

          const fallbackName =
            profile?.full_name ||
            user.user_metadata?.full_name ||
            user.email.split("@")[0] ||
            "New Organization";

          const { data: organization, error: orgError } = await supabase
            .from("organizations")
            .insert({ name: fallbackName })
            .select("id")
            .single();

          if (orgError || !organization) {
            throw new Error("Impossible de récupérer votre organisation.");
          }

          const { error: profileUpsertError } = await supabase
            .from("profiles")
            .upsert({
              id: user.id,
              email: user.email,
              full_name:
                profile?.full_name ?? user.user_metadata?.full_name ?? null,
              organization_id: organization.id,
              role: "member",
            });

          if (profileUpsertError) {
            throw new Error("Impossible de récupérer votre organisation.");
          }

          organizationId = organization.id;
        }

        const { data: audit, error } = await supabase
          .from("audits")
          .insert({
            status: "pending",
            created_by: user.id,
            organization_id: organizationId,
            created_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (error || !audit) {
          throw new Error("Impossible de créer l'audit.");
        }

        if (isMounted) {
          setAuditId(audit.id);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Une erreur est survenue lors de la création de l'audit."
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
  }, [supabase]);

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
      setErrorMessage("Impossible de lancer l'analyse.");
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
            Création de l'audit en cours...
          </CardContent>
        </Card>
      )}

      {!isCreatingAudit && auditId && (
        <>
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

          <Card className="border-slate-200">
            <CardHeader>
              <CardTitle className="text-base font-semibold">
                Review &amp; Submit
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-600">
                {usageUploaded && stripeUploaded
                  ? "Les deux fichiers sont prêts."
                  : "Veuillez uploader les deux fichiers pour continuer."}
              </div>
              <Button
                type="button"
                onClick={handleStartAnalysis}
                disabled={
                  !usageUploaded ||
                  !stripeUploaded ||
                  isSubmitting ||
                  isSubmitted
                }
              >
                {isSubmitting ? "Démarrage..." : "Start Analysis"}
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {isSubmitted && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="flex flex-col gap-4 py-6 text-sm text-emerald-700">
            <p>
              We'll get in touch in the next 3 days with the results !
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push("/dashboard")}
            >
              Retourner au dashboard
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default UploadPage;