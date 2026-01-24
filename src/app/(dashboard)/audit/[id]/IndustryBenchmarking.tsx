"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AreaChartWrapper } from "./AreaChartWrapper";

type IndustryBenchmarkingProps = {
  data3Mo: number[];
  labels3Mo: string[];
  dataYear: number[];
  labelsYear: string[];
};

export function IndustryBenchmarking({
  data3Mo,
  labels3Mo,
  dataYear,
  labelsYear,
}: IndustryBenchmarkingProps) {
  const [period, setPeriod] = useState<"3mo" | "year">("3mo");

  const currentData = period === "3mo" ? data3Mo : dataYear;
  const currentLabels = period === "3mo" ? labels3Mo : labelsYear;

  return (
    <Card className="border-[#E7E5E4]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold text-[#1C1917]">
              Industry Benchmarking
            </CardTitle>
            <p className="text-sm text-[#78716C] mt-1">
              Total for the {period === "3mo" ? "last 3 months" : "last year"}
            </p>
          </div>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as "3mo" | "year")}>
            <TabsList className="h-8">
              <TabsTrigger value="3mo" className="text-xs">
                Last 3mo
              </TabsTrigger>
              <TabsTrigger value="year" className="text-xs">
                Last year
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent>
        <AreaChartWrapper data={currentData} labels={currentLabels} />
      </CardContent>
    </Card>
  );
}
