"use client";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
  TooltipItem,
} from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

type CategoryData = {
  label: string;
  value: number;
  color: string;
};

type BarChartProps = {
  data: CategoryData[];
};

export function BarChart({ data }: BarChartProps) {
  const chartData = {
    labels: data.map((d) => d.label),
    datasets: [
      {
        data: data.map((d) => d.value),
        backgroundColor: data.map((d) => d.color),
        borderRadius: 4,
        barThickness: 24,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: "bottom" as const,
        labels: {
          usePointStyle: true,
          pointStyle: "circle",
          padding: 16,
          font: {
            size: 11,
          },
          color: "#64748b",
          generateLabels: () => {
            return data.map((item) => ({
              text: item.label,
              fillStyle: item.color,
              strokeStyle: item.color,
              hidden: false,
              index: 0,
            }));
          },
        },
      },
      tooltip: {
        backgroundColor: "#1e293b",
        titleColor: "#fff",
        bodyColor: "#fff",
        padding: 12,
        cornerRadius: 8,
        displayColors: true,
        callbacks: {
          label: (context: TooltipItem<"bar">) => {
            const value = context.parsed?.y ?? 0;
            return `$${value.toLocaleString()}`;
          },
        },
      },
    },
    scales: {
      x: {
        display: false,
      },
      y: {
        grid: {
          color: "#f1f5f9",
        },
        border: {
          display: false,
        },
        ticks: {
          color: "#94a3b8",
          font: {
            size: 11,
          },
          callback: (value: number | string) => {
            if (typeof value === "number") {
              if (value >= 1000) {
                return `${value / 1000}k`;
              }
              return `$${value}`;
            }
            return value;
          },
        },
      },
    },
  };

  return (
    <div className="h-48 w-full">
      <Bar data={chartData} options={options} />
    </div>
  );
}
