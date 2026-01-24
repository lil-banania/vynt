// Category configuration with Figma-compliant colors matching dashboard breakdown
export const categoryConfig: Record<
  string,
  { label: string; badgeClass: string; bgColor: string }
> = {
  failed_payment: {
    label: "Failed payment",
    badgeClass: "bg-[#EF4444] text-[#FAFAF9]", // Red - Figma breakdown
    bgColor: "#EF4444",
  },
  duplicate_charge: {
    label: "Duplicate Charge",
    badgeClass: "bg-[#3B82F6] text-[#FAFAF9]", // Blue - Figma breakdown
    bgColor: "#3B82F6",
  },
  zombie_subscription: {
    label: "Zombie Subscription",
    badgeClass: "bg-[#F43F5E] text-[#FAFAF9]", // Rose - Figma breakdown
    bgColor: "#F43F5E",
  },
  unbilled_usage: {
    label: "Unbilled Usage",
    badgeClass: "bg-[#F59E0B] text-[#FAFAF9]", // Amber - Figma breakdown
    bgColor: "#F59E0B",
  },
  disputed_charge: {
    label: "Disputed Charge",
    badgeClass: "bg-[#D946EF] text-[#FAFAF9]", // Fuchsia - Figma breakdown
    bgColor: "#D946EF",
  },
  fee_discrepancy: {
    label: "Fee Discrepancy",
    badgeClass: "bg-[#84CC16] text-[#FAFAF9]", // Lime - Figma breakdown
    bgColor: "#84CC16",
  },
  pricing_mismatch: {
    label: "Pricing Mismatch",
    badgeClass: "bg-[#A855F7] text-[#FAFAF9]", // Purple - Figma breakdown
    bgColor: "#A855F7",
  },
  other: {
    label: "Other",
    badgeClass: "bg-[#64748B] text-[#FAFAF9]", // Slate - Figma breakdown
    bgColor: "#64748B",
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
