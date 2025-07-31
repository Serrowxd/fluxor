"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  TooltipProps,
} from "recharts";
import { TrendingUp, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface TurnoverData {
  product_id: string;
  product_name: string;
  sku: string;
  cogs: number;
  avg_inventory_value: number;
  turnover_ratio: number;
  performance_category: "excellent" | "good" | "fair" | "poor";
  transaction_count: number;
}

interface TurnoverChartProps {
  data: TurnoverData[];
  period?: string;
  onPeriodChange?: (period: string) => void;
}

const CustomTooltip = ({ active, payload }: TooltipProps<number, string>) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload as TurnoverData;

    return (
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
        <p className="font-medium text-sm mb-2">{data.product_name}</p>
        <div className="space-y-1 text-xs">
          <p>
            SKU: <span className="font-medium">{data.sku}</span>
          </p>
          <p>
            Turnover Ratio:{" "}
            <span className="font-bold text-blue-600">
              {data.turnover_ratio}x
            </span>
          </p>
          <p>
            COGS:{" "}
            <span className="font-medium">${data.cogs.toLocaleString()}</span>
          </p>
          <p>
            Avg Inventory Value:{" "}
            <span className="font-medium">
              ${data.avg_inventory_value.toLocaleString()}
            </span>
          </p>
          <p>
            Transactions:{" "}
            <span className="font-medium">{data.transaction_count}</span>
          </p>
          <p>
            Performance:
            <Badge
              variant={
                data.performance_category === "excellent"
                  ? "default"
                  : data.performance_category === "good"
                  ? "secondary"
                  : data.performance_category === "fair"
                  ? "outline"
                  : "destructive"
              }
              className="ml-1 text-xs"
            >
              {data.performance_category}
            </Badge>
          </p>
        </div>
      </div>
    );
  }
  return null;
};

export function TurnoverChart({
  data,
  period = "30 days",
  onPeriodChange,
}: TurnoverChartProps) {
  const [filter, setFilter] = useState<
    "all" | "excellent" | "good" | "fair" | "poor"
  >("all");
  const [hoveredBar, setHoveredBar] = useState<string | null>(null);

  // Sort data by turnover ratio for better visualization
  const sortedData = [...data].sort(
    (a, b) => b.turnover_ratio - a.turnover_ratio
  );

  const filteredData = sortedData.filter((item) => {
    if (filter === "all") return true;
    return item.performance_category === filter;
  });

  const getBarColor = (category: string) => {
    switch (category) {
      case "excellent":
        return "#10b981"; // green-500
      case "good":
        return "#f59e0b"; // amber-500
      case "fair":
        return "#f97316"; // orange-500
      case "poor":
        return "#ef4444"; // red-500
      default:
        return "#6b7280"; // gray-500
    }
  };

  // Calculate benchmark lines
  const benchmarks = {
    excellent: 6,
    good: 4,
    fair: 2,
  };

  // Performance distribution
  const performanceCount = {
    excellent: data.filter((item) => item.performance_category === "excellent")
      .length,
    good: data.filter((item) => item.performance_category === "good").length,
    fair: data.filter((item) => item.performance_category === "fair").length,
    poor: data.filter((item) => item.performance_category === "poor").length,
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Inventory Turnover Analysis
            </CardTitle>
            <CardDescription>
              How quickly products are sold and replaced over {period}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {onPeriodChange && (
              <Select value={period} onValueChange={onPeriodChange}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7 days">Last 7 days</SelectItem>
                  <SelectItem value="30 days">Last 30 days</SelectItem>
                  <SelectItem value="90 days">Last 90 days</SelectItem>
                  <SelectItem value="365 days">Last year</SelectItem>
                </SelectContent>
              </Select>
            )}

            <Filter className="h-4 w-4 text-muted-foreground" />
            <div className="flex gap-1">
              <Badge
                variant={filter === "all" ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setFilter("all")}
              >
                All ({data.length})
              </Badge>
              <Badge
                variant={filter === "excellent" ? "default" : "outline"}
                className="cursor-pointer bg-green-100 text-green-800 hover:bg-green-200"
                onClick={() => setFilter("excellent")}
              >
                Excellent ({performanceCount.excellent})
              </Badge>
              <Badge
                variant={filter === "good" ? "default" : "outline"}
                className="cursor-pointer bg-amber-100 text-amber-800 hover:bg-amber-200"
                onClick={() => setFilter("good")}
              >
                Good ({performanceCount.good})
              </Badge>
              <Badge
                variant={filter === "fair" ? "default" : "outline"}
                className="cursor-pointer bg-orange-100 text-orange-800 hover:bg-orange-200"
                onClick={() => setFilter("fair")}
              >
                Fair ({performanceCount.fair})
              </Badge>
              <Badge
                variant={filter === "poor" ? "destructive" : "outline"}
                className="cursor-pointer"
                onClick={() => setFilter("poor")}
              >
                Poor ({performanceCount.poor})
              </Badge>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={filteredData}
              margin={{ top: 20, right: 5, left: 5, bottom: 100 }}
              onMouseMove={(e) => {
                if (e && e.activeLabel) {
                  setHoveredBar(e.activeLabel);
                }
              }}
              onMouseLeave={() => setHoveredBar(null)}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                className="stroke-muted"
                vertical={false}
              />
              <XAxis
                dataKey="product_name"
                className="text-xs"
                tick={{ fill: "currentColor" }}
                angle={-45}
                textAnchor="end"
                height={100}
                interval={0}
              />
              <YAxis
                className="text-xs"
                tick={{ fill: "currentColor" }}
                label={{
                  value: "Turnover Ratio",
                  angle: -90,
                  position: "insideLeft",
                  className: "fill-muted-foreground text-xs",
                }}
              />
              <Tooltip content={<CustomTooltip />} />

              {/* Benchmark reference lines */}
              <ReferenceLine
                y={benchmarks.excellent}
                stroke="#10b981"
                strokeDasharray="3 3"
                opacity={0.7}
                label={{
                  value: "Excellent (6x+)",
                  position: "topRight",
                  className: "fill-green-600 text-xs font-medium",
                }}
              />
              <ReferenceLine
                y={benchmarks.good}
                stroke="#f59e0b"
                strokeDasharray="3 3"
                opacity={0.7}
                label={{
                  value: "Good (4x+)",
                  position: "topRight",
                  className: "fill-amber-600 text-xs font-medium",
                }}
              />
              <ReferenceLine
                y={benchmarks.fair}
                stroke="#f97316"
                strokeDasharray="3 3"
                opacity={0.7}
                label={{
                  value: "Fair (2x+)",
                  position: "topRight",
                  className: "fill-orange-600 text-xs font-medium",
                }}
              />

              <Bar dataKey="turnover_ratio" radius={[4, 4, 0, 0]}>
                {filteredData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={getBarColor(entry.performance_category)}
                    className={cn(
                      "transition-opacity duration-200",
                      hoveredBar &&
                        hoveredBar !== entry.product_name &&
                        "opacity-50"
                    )}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Summary Statistics */}
        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Average Turnover</p>
            <p className="text-lg font-semibold">
              {(
                data.reduce((sum, item) => sum + item.turnover_ratio, 0) /
                data.length
              ).toFixed(1)}
              x
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Highest Performer</p>
            <p className="text-lg font-semibold text-green-600">
              {Math.max(...data.map((item) => item.turnover_ratio)).toFixed(1)}x
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Total COGS</p>
            <p className="text-lg font-semibold">
              ${data.reduce((sum, item) => sum + item.cogs, 0).toLocaleString()}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Avg Inventory Value</p>
            <p className="text-lg font-semibold">
              $
              {(
                data.reduce((sum, item) => sum + item.avg_inventory_value, 0) /
                data.length
              ).toLocaleString()}
            </p>
          </div>
        </div>

        {/* Performance Legend */}
        <div className="mt-4 flex items-center justify-center gap-6 pt-4 border-t">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-green-500" />
            <span className="text-sm text-muted-foreground">
              Excellent (6x+)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-amber-500" />
            <span className="text-sm text-muted-foreground">Good (4-6x)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-orange-500" />
            <span className="text-sm text-muted-foreground">Fair (2-4x)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-red-500" />
            <span className="text-sm text-muted-foreground">Poor (&lt;2x)</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
