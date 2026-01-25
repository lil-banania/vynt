import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { categoryConfig } from "@/lib/utils/category-config";

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
  },
  {
    key: "unbilled_usage",
    label: "Unbilled Usage",
  },
  {
    key: "pricing_mismatch",
    label: "Pricing Mismatch",
  },
  {
    key: "duplicate_charge",
    label: "Duplicate Charge",
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
                  className="h-2 rounded-full"
                  style={{
                    backgroundColor:
                      categoryConfig[category.key]?.chartColor ??
                      categoryConfig.other.chartColor,
                    width: `${percent}%`,
                  }}
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