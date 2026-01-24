"use client";

import { BarChart } from "@/components/charts/BarChart";

type CategoryData = {
  label: string;
  value: number;
  color: string;
};

type BarChartWrapperProps = {
  data: CategoryData[];
};

export function BarChartWrapper({ data }: BarChartWrapperProps) {
  return <BarChart data={data} />;
}
