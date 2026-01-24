"use client";

import { AreaChart } from "@/components/charts/AreaChart";

type AreaChartWrapperProps = {
  data: number[];
  labels: string[];
};

export function AreaChartWrapper({ data, labels }: AreaChartWrapperProps) {
  return <AreaChart data={data} labels={labels} />;
}
