// Category configuration with Figma-compliant colors.
// Source of truth for chart colors: Figma "Breakdown by Category" legend (Report -> Overview).
export const categoryConfig: Record<
  string,
  { label: string; badgeClass: string; bgColor: string; chartColor: string }
> = {
  failed_payment: {
    label: "Failed Payment",
    // Chart legend: "Failed" -> base/chart-1 = #ea580c
    chartColor: "#EA580C",
    badgeClass: "bg-[#EA580C]/10 text-[#EA580C] border border-[#EA580C]/20",
    bgColor: "#EA580C",
  },
  duplicate_charge: {
    label: "Duplicate Charge",
    // Chart legend: "Duplicate" -> base/chart-2 = #0d9488
    chartColor: "#0D9488",
    badgeClass: "bg-[#0D9488]/10 text-[#0D9488] border border-[#0D9488]/20",
    bgColor: "#0D9488",
  },
  zombie_subscription: {
    label: "Zombie Subscription",
    // Chart legend: "Zombie" -> base/chart-3 = #164e63
    chartColor: "#164E63",
    badgeClass: "bg-[#164E63]/10 text-[#164E63] border border-[#164E63]/20",
    bgColor: "#164E63",
  },
  unbilled_usage: {
    label: "Unbilled Usage",
    // Chart legend: "Unbilled" -> base/chart-4 = #fbbf24
    chartColor: "#FBBF24",
    // Use a readable warning foreground for text (Figma token: #A16207)
    badgeClass: "bg-[#FBBF24]/15 text-[#A16207] border border-[#FBBF24]/30",
    bgColor: "#A16207",
  },
  disputed_charge: {
    label: "Disputed Charge",
    // Chart legend: "Disputed" -> base/chart-5 = #f59e0b
    chartColor: "#F59E0B",
    badgeClass: "bg-[#F59E0B]/12 text-[#B45309] border border-[#F59E0B]/25",
    bgColor: "#B45309",
  },
  fee_discrepancy: {
    label: "Fee Discrepancy",
    // Chart legend: "Fee" -> base/chart-6 = #5b21b6
    chartColor: "#5B21B6",
    badgeClass: "bg-[#5B21B6]/10 text-[#5B21B6] border border-[#5B21B6]/20",
    bgColor: "#5B21B6",
  },
  pricing_mismatch: {
    label: "Pricing Mismatch",
    // Not in the v0 Figma legend; pick a distinct, readable hue (blue) to avoid duplicates.
    chartColor: "#3B82F6",
    badgeClass: "bg-[#3B82F6]/10 text-[#1D4ED8] border border-[#3B82F6]/20",
    bgColor: "#1D4ED8",
  },
  other: {
    label: "Other",
    chartColor: "#64748B",
    badgeClass: "bg-[#FFFFFF] text-[#0A0A0A] border border-[#E7E5E4]",
    bgColor: "#0A0A0A",
  },
};

export const formatCurrency = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return "$0";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
};
