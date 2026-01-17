import { redirect } from "next/navigation";

import ReconciliationSettingsForm from "@/components/settings/ReconciliationSettingsForm";
import { createClient } from "@/lib/supabase/server";
import { Organization, Profile } from "@/lib/types/database";

type ReconciliationConfig = {
  payoutGraceDays?: number;
  unreconciledRiskPct?: number;
  feeDiscrepancyThresholdCents?: number;
  timingMismatchDays?: number;
  payoutGroupMinTransactions?: number;
  grossDiffThresholdCents?: number;
  annualizationMonths?: number;
  chargebackFeeAmount?: number;
  currencyCode?: string;
};

type StoredConfig = {
  preset?: string;
  settings?: ReconciliationConfig;
} & ReconciliationConfig;

const SettingsPage = async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, organization_id, role")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  if (!profile) {
    redirect("/login");
  }

  const { data: organization } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", profile.organization_id)
    .maybeSingle<Organization & { reconciliation_config?: StoredConfig | null }>();

  const rawConfig = organization?.reconciliation_config ?? null;
  const initialPreset =
    rawConfig && typeof rawConfig.preset === "string" ? rawConfig.preset : "custom";
  const initialConfig =
    rawConfig && rawConfig.settings && typeof rawConfig.settings === "object"
      ? rawConfig.settings
      : rawConfig ?? {};

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-600">
          Manage your account and organization preferences.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <ReconciliationSettingsForm
          initialConfig={initialConfig}
          initialPreset={initialPreset}
          organizationName={organization?.name ?? "your organization"}
        />
      </div>
    </div>
  );
};

export default SettingsPage;
