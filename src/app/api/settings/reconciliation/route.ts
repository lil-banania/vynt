import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

import { createClient as createServerClient } from "@/lib/supabase/server";

const DEFAULT_CONFIG = {
  payoutGraceDays: 4,
  unreconciledRiskPct: 0.05,
  feeDiscrepancyThresholdCents: 100,
  timingMismatchDays: 1,
  payoutGroupMinTransactions: 3,
  grossDiffThresholdCents: 100,
  annualizationMonths: 12,
  chargebackFeeAmount: 15,
  currencyCode: undefined as string | undefined,
};

type ReconciliationConfig = typeof DEFAULT_CONFIG;

function resolveConfig(input: Partial<ReconciliationConfig> | null | undefined): ReconciliationConfig {
  return {
    payoutGraceDays: Number.isFinite(input?.payoutGraceDays)
      ? Math.max(0, Number(input?.payoutGraceDays))
      : DEFAULT_CONFIG.payoutGraceDays,
    unreconciledRiskPct: Number.isFinite(input?.unreconciledRiskPct)
      ? Math.max(0, Number(input?.unreconciledRiskPct))
      : DEFAULT_CONFIG.unreconciledRiskPct,
    feeDiscrepancyThresholdCents: Number.isFinite(input?.feeDiscrepancyThresholdCents)
      ? Math.max(0, Number(input?.feeDiscrepancyThresholdCents))
      : DEFAULT_CONFIG.feeDiscrepancyThresholdCents,
    timingMismatchDays: Number.isFinite(input?.timingMismatchDays)
      ? Math.max(0, Number(input?.timingMismatchDays))
      : DEFAULT_CONFIG.timingMismatchDays,
    payoutGroupMinTransactions: Number.isFinite(input?.payoutGroupMinTransactions)
      ? Math.max(1, Number(input?.payoutGroupMinTransactions))
      : DEFAULT_CONFIG.payoutGroupMinTransactions,
    grossDiffThresholdCents: Number.isFinite(input?.grossDiffThresholdCents)
      ? Math.max(0, Number(input?.grossDiffThresholdCents))
      : DEFAULT_CONFIG.grossDiffThresholdCents,
    annualizationMonths: Number.isFinite(input?.annualizationMonths)
      ? Math.max(1, Number(input?.annualizationMonths))
      : DEFAULT_CONFIG.annualizationMonths,
    chargebackFeeAmount: Number.isFinite(input?.chargebackFeeAmount)
      ? Math.max(0, Number(input?.chargebackFeeAmount))
      : DEFAULT_CONFIG.chargebackFeeAmount,
    currencyCode:
      typeof input?.currencyCode === "string" && input.currencyCode.trim()
        ? input.currencyCode.trim().toUpperCase()
        : undefined,
  };
}

const ADMIN_ROLES = new Set(["owner", "admin", "vynt_admin"]);

export async function POST(request: Request) {
  const serverSupabase = await createServerClient();
  const {
    data: { user },
    error: userError,
  } = await serverSupabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await serverSupabase
    .from("profiles")
    .select("id, organization_id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !ADMIN_ROLES.has(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const preset = typeof body?.preset === "string" ? body.preset : "custom";
  const settings = resolveConfig(body?.config);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Server configuration missing." }, { status: 500 });
  }

  const adminSupabase = createAdminClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: organization } = await adminSupabase
    .from("organizations")
    .select("reconciliation_config")
    .eq("id", profile.organization_id)
    .maybeSingle();

  const existingConfig =
    organization && typeof organization.reconciliation_config === "object"
      ? (organization.reconciliation_config as Record<string, unknown>)
      : {};
  const existingHistory = Array.isArray(existingConfig.history)
    ? existingConfig.history
    : [];

  const historyEntry = {
    preset,
    settings,
    updated_at: new Date().toISOString(),
    updated_by: user.id,
  };

  const { error: updateError } = await adminSupabase
    .from("organizations")
    .update({
      reconciliation_config: {
        preset,
        settings,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
        history: [...existingHistory, historyEntry],
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", profile.organization_id);

  if (updateError) {
    return NextResponse.json({ error: "Unable to save settings." }, { status: 500 });
  }

  return NextResponse.json({ success: true, preset, settings });
}
