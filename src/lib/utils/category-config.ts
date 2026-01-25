// Category configuration with Figma-compliant colors matching the "All anomalies" screen
export const categoryConfig: Record<
  string,
  { label: string; badgeClass: string; bgColor: string }
> = {
  failed_payment: {
    label: "Failed Payment",
    // Figma: outline pill
    badgeClass: "bg-[#FFFFFF] text-[#0A0A0A] border border-[#E7E5E4]",
    bgColor: "#0A0A0A",
  },
  duplicate_charge: {
    label: "Duplicate Charge",
    // Figma: purple pill
    badgeClass: "bg-[#F3E8FF] text-[#7E22CE] border border-[#E9D5FF]",
    bgColor: "#7E22CE",
  },
  zombie_subscription: {
    label: "Zombie Subscription",
    // Figma: warning pill
    badgeClass: "bg-[#FEF3C7] text-[#A16207] border border-[#FDE68A]",
    bgColor: "#A16207",
  },
  unbilled_usage: {
    label: "Unbilled Usage",
    // Figma: destructive pill
    badgeClass: "bg-[#DC26261A] text-[#991B1B] border border-[#DC262633]",
    bgColor: "#991B1B",
  },
  disputed_charge: {
    label: "Disputed Charge",
    // Not shown on the All anomalies frame we sampled; use destructive tonality
    badgeClass: "bg-[#DC26261A] text-[#991B1B] border border-[#DC262633]",
    bgColor: "#991B1B",
  },
  fee_discrepancy: {
    label: "Fee Discrepancy",
    // Not shown on the All anomalies frame we sampled; use warning tonality
    badgeClass: "bg-[#FEF3C7] text-[#A16207] border border-[#FDE68A]",
    bgColor: "#A16207",
  },
  pricing_mismatch: {
    label: "Pricing Mismatch",
    // Not shown on the All anomalies frame we sampled; use success tonality
    badgeClass: "bg-[#DCFCE7] text-[#15803D] border border-[#BBF7D0]",
    bgColor: "#15803D",
  },
  other: {
    label: "Other",
    // Neutral outline
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
