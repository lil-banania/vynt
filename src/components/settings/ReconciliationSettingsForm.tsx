"use client";

import { useMemo, useState } from "react";

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

type ReconciliationConfig = {
  payoutGraceDays: number;
  unreconciledRiskPct: number;
  feeDiscrepancyThresholdCents: number;
  timingMismatchDays: number;
  payoutGroupMinTransactions: number;
  grossDiffThresholdCents: number;
  annualizationMonths: number;
  chargebackFeeAmount: number;
  currencyCode: string;
};

type ReconciliationSettingsFormProps = {
  initialConfig: Partial<ReconciliationConfig>;
  initialPreset: string;
  organizationName: string;
};

const DEFAULT_CONFIG: ReconciliationConfig = {
  payoutGraceDays: 4,
  unreconciledRiskPct: 0.05,
  feeDiscrepancyThresholdCents: 100,
  timingMismatchDays: 1,
  payoutGroupMinTransactions: 3,
  grossDiffThresholdCents: 100,
  annualizationMonths: 12,
  chargebackFeeAmount: 15,
  currencyCode: "",
};

const PRESETS: Record<string, ReconciliationConfig> = {
  startup: {
    payoutGraceDays: 2,
    unreconciledRiskPct: 0.08,
    feeDiscrepancyThresholdCents: 50,
    timingMismatchDays: 1,
    payoutGroupMinTransactions: 2,
    grossDiffThresholdCents: 50,
    annualizationMonths: 12,
    chargebackFeeAmount: 15,
    currencyCode: "",
  },
  scale: {
    payoutGraceDays: 4,
    unreconciledRiskPct: 0.05,
    feeDiscrepancyThresholdCents: 100,
    timingMismatchDays: 2,
    payoutGroupMinTransactions: 3,
    grossDiffThresholdCents: 100,
    annualizationMonths: 12,
    chargebackFeeAmount: 15,
    currencyCode: "",
  },
  enterprise: {
    payoutGraceDays: 7,
    unreconciledRiskPct: 0.03,
    feeDiscrepancyThresholdCents: 250,
    timingMismatchDays: 3,
    payoutGroupMinTransactions: 5,
    grossDiffThresholdCents: 250,
    annualizationMonths: 12,
    chargebackFeeAmount: 15,
    currencyCode: "",
  },
};

const normalizeConfig = (
  input: Partial<ReconciliationConfig>
): ReconciliationConfig => ({
  payoutGraceDays:
    typeof input.payoutGraceDays === "number"
      ? input.payoutGraceDays
      : DEFAULT_CONFIG.payoutGraceDays,
  unreconciledRiskPct:
    typeof input.unreconciledRiskPct === "number"
      ? input.unreconciledRiskPct
      : DEFAULT_CONFIG.unreconciledRiskPct,
  feeDiscrepancyThresholdCents:
    typeof input.feeDiscrepancyThresholdCents === "number"
      ? input.feeDiscrepancyThresholdCents
      : DEFAULT_CONFIG.feeDiscrepancyThresholdCents,
  timingMismatchDays:
    typeof input.timingMismatchDays === "number"
      ? input.timingMismatchDays
      : DEFAULT_CONFIG.timingMismatchDays,
  payoutGroupMinTransactions:
    typeof input.payoutGroupMinTransactions === "number"
      ? input.payoutGroupMinTransactions
      : DEFAULT_CONFIG.payoutGroupMinTransactions,
  grossDiffThresholdCents:
    typeof input.grossDiffThresholdCents === "number"
      ? input.grossDiffThresholdCents
      : DEFAULT_CONFIG.grossDiffThresholdCents,
  annualizationMonths:
    typeof input.annualizationMonths === "number"
      ? input.annualizationMonths
      : DEFAULT_CONFIG.annualizationMonths,
  chargebackFeeAmount:
    typeof input.chargebackFeeAmount === "number"
      ? input.chargebackFeeAmount
      : DEFAULT_CONFIG.chargebackFeeAmount,
  currencyCode: input.currencyCode ?? DEFAULT_CONFIG.currencyCode,
});

const ReconciliationSettingsForm = ({
  initialConfig,
  initialPreset,
  organizationName,
}: ReconciliationSettingsFormProps) => {
  const startingConfig = useMemo(
    () => normalizeConfig(initialConfig),
    [initialConfig]
  );
  const [preset, setPreset] = useState(initialPreset || "custom");
  const [config, setConfig] = useState<ReconciliationConfig>(startingConfig);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const updateConfig = (key: keyof ReconciliationConfig, value: number | string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    if (preset !== "custom") {
      setPreset("custom");
    }
  };

  const applyPreset = (nextPreset: string) => {
    setPreset(nextPreset);
    if (nextPreset !== "custom" && PRESETS[nextPreset]) {
      setConfig((prev) => ({
        ...PRESETS[nextPreset],
        currencyCode: prev.currencyCode,
      }));
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/settings/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preset,
          config,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to save settings.");
      }

      setMessage("Settings saved successfully.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to save settings."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setConfig(DEFAULT_CONFIG);
    setPreset("custom");
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Reconciliation Settings
        </h2>
        <p className="text-sm text-slate-600">
          Configure reconciliation thresholds for {organizationName}.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Preset</Label>
          <Select value={preset} onValueChange={applyPreset}>
            <SelectTrigger>
              <SelectValue placeholder="Select a preset" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="startup">Startup</SelectItem>
              <SelectItem value="scale">Scale-up</SelectItem>
              <SelectItem value="enterprise">Enterprise</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="currencyCode">Currency (optional)</Label>
          <Input
            id="currencyCode"
            placeholder="USD"
            value={config.currencyCode}
            onChange={(event) => updateConfig("currencyCode", event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="payoutGraceDays">Payout grace period (days)</Label>
          <Input
            id="payoutGraceDays"
            type="number"
            min={0}
            value={config.payoutGraceDays}
            onChange={(event) =>
              updateConfig("payoutGraceDays", Number(event.target.value))
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="unreconciledRiskPct">Unreconciled risk %</Label>
          <Input
            id="unreconciledRiskPct"
            type="number"
            step="0.01"
            min={0}
            value={config.unreconciledRiskPct}
            onChange={(event) =>
              updateConfig("unreconciledRiskPct", Number(event.target.value))
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="feeDiscrepancyThresholdCents">
            Fee discrepancy threshold (cents)
          </Label>
          <Input
            id="feeDiscrepancyThresholdCents"
            type="number"
            min={0}
            value={config.feeDiscrepancyThresholdCents}
            onChange={(event) =>
              updateConfig(
                "feeDiscrepancyThresholdCents",
                Number(event.target.value)
              )
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="timingMismatchDays">Timing mismatch (days)</Label>
          <Input
            id="timingMismatchDays"
            type="number"
            min={0}
            value={config.timingMismatchDays}
            onChange={(event) =>
              updateConfig("timingMismatchDays", Number(event.target.value))
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="payoutGroupMinTransactions">
            Payout grouping minimum transactions
          </Label>
          <Input
            id="payoutGroupMinTransactions"
            type="number"
            min={1}
            value={config.payoutGroupMinTransactions}
            onChange={(event) =>
              updateConfig(
                "payoutGroupMinTransactions",
                Number(event.target.value)
              )
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="grossDiffThresholdCents">
            Gross discrepancy threshold (cents)
          </Label>
          <Input
            id="grossDiffThresholdCents"
            type="number"
            min={0}
            value={config.grossDiffThresholdCents}
            onChange={(event) =>
              updateConfig(
                "grossDiffThresholdCents",
                Number(event.target.value)
              )
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="annualizationMonths">Annualization months</Label>
          <Input
            id="annualizationMonths"
            type="number"
            min={1}
            value={config.annualizationMonths}
            onChange={(event) =>
              updateConfig("annualizationMonths", Number(event.target.value))
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="chargebackFeeAmount">
            Chargeback fee amount (currency units)
          </Label>
          <Input
            id="chargebackFeeAmount"
            type="number"
            min={0}
            step="0.01"
            value={config.chargebackFeeAmount}
            onChange={(event) =>
              updateConfig("chargebackFeeAmount", Number(event.target.value))
            }
          />
        </div>
      </div>

      {message ? (
        <p className="text-sm text-emerald-600">{message}</p>
      ) : null}
      {errorMessage ? (
        <p className="text-sm text-rose-600">{errorMessage}</p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? "Saving..." : "Save settings"}
        </Button>
        <Button variant="ghost" onClick={handleReset} disabled={isSaving}>
          Reset to defaults
        </Button>
      </div>
    </div>
  );
};

export default ReconciliationSettingsForm;
