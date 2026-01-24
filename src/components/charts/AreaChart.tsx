"use client";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  TooltipItem,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend
);

type AreaChartProps = {
  data: number[];
  labels: string[];
  color?: string;
};

export function AreaChart({
  data,
  labels,
  color = "#F97316",
}: AreaChartProps) {
  const chartData = {
    labels,
    datasets: [
      {
        data,
        fill: true,
        backgroundColor: `${color}20`,
        borderColor: color,
        borderWidth: 2,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: color,
        pointHoverBorderColor: "#fff",
        pointHoverBorderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: "#1e293b",
        titleColor: "#fff",
        bodyColor: "#fff",
        padding: 12,
        cornerRadius: 8,
        displayColors: false,
        callbacks: {
          label: (context: TooltipItem<"line">) => {
            const value = context.parsed?.y ?? 0;
            return `$${value.toLocaleString()}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
        border: {
          display: false,
        },
        ticks: {
          color: "#94a3b8",
          font: {
            size: 11,
          },
        },
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
              return `$${value.toLocaleString()}`;
            }
            return value;
          },
        },
      },
    },
    interaction: {
      intersect: false,
      mode: "index" as const,
    },
  };

  return (
    <div className="h-56 w-full">
      <Line data={chartData} options={options} />
    </div>
  );
}
