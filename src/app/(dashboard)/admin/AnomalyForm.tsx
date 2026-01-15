"use client";

import { useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { AnomalyCategory, AnomalyConfidence } from "@/lib/types/database";

type AnomalyFormProps = {
  auditId: string;
  triggerLabel?: string;
};

type FormState = {
  category: AnomalyCategory | "";
  customerId: string;
  confidence: AnomalyConfidence | "";
  annualImpact: string;
  monthlyImpact: string;
  description: string;
  rootCause: string;
  recommendation: string;
};

type FormErrors = Partial<Record<keyof FormState, string>>;

const initialState: FormState = {
  category: "",
  customerId: "",
  confidence: "",
  annualImpact: "",
  monthlyImpact: "",
  description: "",
  rootCause: "",
  recommendation: "",
};

const AnomalyForm = ({ auditId, triggerLabel = "Add Anomalies" }: AnomalyFormProps) => {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(initialState);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMonthlyTouched, setIsMonthlyTouched] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const setField = (field: keyof FormState, value: string) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validate = () => {
    const nextErrors: FormErrors = {};
    if (!form.category) {
      nextErrors.category = "Category is required.";
    }
    if (!form.confidence) {
      nextErrors.confidence = "Confidence is required.";
    }
    if (!form.annualImpact.trim()) {
      nextErrors.annualImpact = "Annual impact is required.";
    } else if (Number.isNaN(Number(form.annualImpact))) {
      nextErrors.annualImpact = "Annual impact must be a number.";
    }
    if (form.monthlyImpact.trim() && Number.isNaN(Number(form.monthlyImpact))) {
      nextErrors.monthlyImpact = "Monthly impact must be a number.";
    }
    if (!form.description.trim()) {
      nextErrors.description = "Description is required.";
    }
    if (!form.rootCause.trim()) {
      nextErrors.rootCause = "Root cause is required.";
    }
    if (!form.recommendation.trim()) {
      nextErrors.recommendation = "Recommendation is required.";
    }
    return nextErrors;
  };

  const handleAnnualChange = (value: string) => {
    setField("annualImpact", value);
    if (!isMonthlyTouched) {
      const numeric = Number(value);
      if (!Number.isNaN(numeric)) {
        const monthly = numeric / 12;
        setField(
          "monthlyImpact",
          monthly ? monthly.toFixed(2).replace(/\.00$/, "") : ""
        );
      }
    }
  };

  const handleMonthlyChange = (value: string) => {
    setIsMonthlyTouched(true);
    setField("monthlyImpact", value);
  };

  const resetForm = () => {
    setForm(initialState);
    setErrors({});
    setIsMonthlyTouched(false);
    setSubmitError(null);
    setSubmitSuccess(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(null);

    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setIsSubmitting(true);
    const { error } = await supabase.from("anomalies").insert({
      audit_id: auditId,
      category: form.category,
      customer_id: form.customerId.trim() || null,
      confidence: form.confidence,
      status: "open",
      annual_impact: Number(form.annualImpact),
      monthly_impact: form.monthlyImpact
        ? Number(form.monthlyImpact)
        : null,
      description: form.description.trim(),
      root_cause: form.rootCause.trim(),
      recommendation: form.recommendation.trim(),
      detected_at: new Date().toISOString(),
    });

    if (error) {
      setSubmitError("Unable to save anomaly. Please try again.");
    } else {
      setSubmitSuccess("Anomaly added successfully.");
      resetForm();
    }
    setIsSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm" type="button">
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add anomaly</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`category-${auditId}`}>Category</Label>
              <Select
                value={form.category}
                onValueChange={(value: string) =>
                  setField("category", value)
                }
              >
                <SelectTrigger id={`category-${auditId}`}>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zombie_subscription">
                    Zombie Subscription
                  </SelectItem>
                  <SelectItem value="unbilled_usage">
                    Unbilled Usage
                  </SelectItem>
                  <SelectItem value="pricing_mismatch">
                    Pricing Mismatch
                  </SelectItem>
                  <SelectItem value="duplicate_charge">
                    Duplicate Charge
                  </SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              {errors.category && (
                <p className="text-xs text-rose-600">{errors.category}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor={`confidence-${auditId}`}>Confidence</Label>
              <Select
                value={form.confidence}
                onValueChange={(value: string) =>
                  setField("confidence", value)
                }
              >
                <SelectTrigger id={`confidence-${auditId}`}>
                  <SelectValue placeholder="Select confidence" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
              {errors.confidence && (
                <p className="text-xs text-rose-600">{errors.confidence}</p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor={`customer-${auditId}`}>Customer ID</Label>
            <Input
              id={`customer-${auditId}`}
              value={form.customerId}
              onChange={(event) => setField("customerId", event.target.value)}
              placeholder="cus_123"
            />
            {errors.customerId && (
              <p className="text-xs text-rose-600">{errors.customerId}</p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`annual-${auditId}`}>Annual impact</Label>
              <Input
                id={`annual-${auditId}`}
                type="number"
                value={form.annualImpact}
                onChange={(event) => handleAnnualChange(event.target.value)}
                placeholder="120000"
              />
              {errors.annualImpact && (
                <p className="text-xs text-rose-600">{errors.annualImpact}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor={`monthly-${auditId}`}>Monthly impact</Label>
              <Input
                id={`monthly-${auditId}`}
                type="number"
                value={form.monthlyImpact}
                onChange={(event) => handleMonthlyChange(event.target.value)}
                placeholder="10000"
              />
              {errors.monthlyImpact && (
                <p className="text-xs text-rose-600">{errors.monthlyImpact}</p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor={`description-${auditId}`}>Description</Label>
            <Textarea
              id={`description-${auditId}`}
              value={form.description}
              onChange={(event) => setField("description", event.target.value)}
              placeholder="Describe the anomaly..."
            />
            {errors.description && (
              <p className="text-xs text-rose-600">{errors.description}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor={`root-${auditId}`}>Root cause</Label>
            <Textarea
              id={`root-${auditId}`}
              value={form.rootCause}
              onChange={(event) => setField("rootCause", event.target.value)}
              placeholder="Explain the root cause..."
            />
            {errors.rootCause && (
              <p className="text-xs text-rose-600">{errors.rootCause}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor={`recommendation-${auditId}`}>
              Recommendation
            </Label>
            <Textarea
              id={`recommendation-${auditId}`}
              value={form.recommendation}
              onChange={(event) =>
                setField("recommendation", event.target.value)
              }
              placeholder="Provide recommended actions..."
            />
            {errors.recommendation && (
              <p className="text-xs text-rose-600">
                {errors.recommendation}
              </p>
            )}
          </div>

          {submitError && (
            <p className="text-sm text-rose-600">{submitError}</p>
          )}
          {submitSuccess && (
            <p className="text-sm text-emerald-600">{submitSuccess}</p>
          )}

          <div className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetForm();
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Save anomaly"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AnomalyForm;