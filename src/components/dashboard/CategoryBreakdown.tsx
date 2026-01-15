import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type CategoryBreakdownProps = {
  anomalyCounts: {
    zombie_subscription: number;
    unbilled_usage: number;
    pricing_mismatch: number;
    duplicate_charge: number;
  };
};

const categories = [
  {
    key: "zombie_subscription",
    label: "Zombie Subscriptions",
    color: "bg-red-500",
  },
  {
    key: "unbilled_usage",
    label: "Unbilled Usage",
    color: "bg-orange-500",
  },
  {
    key: "pricing_mismatch",
    label: "Pricing Mismatch",
    color: "bg-yellow-400",
  },
  {
    key: "duplicate_charge",
    label: "Duplicate Charge",
    color: "bg-blue-500",
  },
] as const;

const CategoryBreakdown = ({ anomalyCounts }: CategoryBreakdownProps) => {
  const total = Math.max(
    1,
    anomalyCounts.zombie_subscription +
      anomalyCounts.unbilled_usage +
      anomalyCounts.pricing_mismatch +
      anomalyCounts.duplicate_charge
  );

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-slate-900">
          Breakdown by Category
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {categories.map((category) => {
          const value = anomalyCounts[category.key];
          const percent = (value / total) * 100;
          return (
            <div key={category.key} className="space-y-2">
              <div className="flex items-center justify-between text-sm text-slate-600">
                <span>{category.label}</span>
                <span className="font-medium text-slate-900">{value}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100">
                <div
                  className={`h-2 rounded-full ${category.color}`}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default CategoryBreakdown;