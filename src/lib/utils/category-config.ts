// Category configuration with Figma-compliant colors for better readability
export const categoryConfig: Record<
  string,
  { label: string; badgeClass: string }
> = {
  failed_payment: {
    label: "Failed payment",
    badgeClass: "bg-[#DC2626] text-[#FAFAF9]", // Red - Critical
  },
  duplicate_charge: {
    label: "Duplicate Charge",
    badgeClass: "bg-[#2563EB] text-[#FAFAF9]", // Blue - Data integrity
  },
  zombie_subscription: {
    label: "Zombie Subscription",
    badgeClass: "bg-[#7C3AED] text-[#FAFAF9]", // Purple - Lifecycle
  },
  unbilled_usage: {
    label: "Unbilled Usage",
    badgeClass: "bg-[#EA580C] text-[#FAFAF9]", // Orange - Revenue leak
  },
  disputed_charge: {
    label: "Disputed Charge",
    badgeClass: "bg-[#DC2626] text-[#FAFAF9]", // Red - Customer conflict
  },
  fee_discrepancy: {
    label: "Fee Discrepancy",
    badgeClass: "bg-[#CA8A04] text-[#FAFAF9]", // Yellow - Operational
  },
  pricing_mismatch: {
    label: "Pricing Mismatch",
    badgeClass: "bg-[#16A34A] text-[#FAFAF9]", // Green - Configuration
  },
  other: {
    label: "Other",
    badgeClass: "bg-[#78716C] text-[#FAFAF9]", // Gray - Uncategorized
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
