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
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  TooltipProps,
  Cell,
} from "recharts";
import { DollarSign, TrendingUp, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface MarginData {
  product_id: string;
  product_name: string;
  sku: string;
  unit_cost: number;
  selling_price: number;
  avg_selling_price: number;
  total_quantity_sold: number;
  total_revenue: number;
  total_cost: number;
  gross_profit: number;
  gross_margin_percentage: number;
  list_price_margin_percentage: number;
  avg_revenue_per_unit: number;
}

interface MarginAnalysisChartProps {
  data: MarginData[];
  period?: string;
  onPeriodChange?: (period: string) => void;
}

const CustomTooltip = ({ active, payload }: TooltipProps<number, string>) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload as MarginData & { x: number; y: number };

    return (
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-w-xs">
        <p className="font-medium text-sm mb-2">{data.product_name}</p>
        <div className="space-y-1 text-xs">
          <p>
            SKU: <span className="font-medium">{data.sku}</span>
          </p>
          <p>
            Gross Margin:{" "}
            <span className="font-bold text-green-600">
              {data.gross_margin_percentage.toFixed(1)}%
            </span>
          </p>
          <p>
            Total Revenue:{" "}
            <span className="font-medium">
              ${data.total_revenue.toLocaleString()}
            </span>
          </p>
          <p>
            Gross Profit:{" "}
            <span className="font-medium">
              ${data.gross_profit.toLocaleString()}
            </span>
          </p>
          <p>
            Units Sold:{" "}
            <span className="font-medium">{data.total_quantity_sold}</span>
          </p>
          <p>
            Avg Price:{" "}
            <span className="font-medium">
              ${data.avg_selling_price.toFixed(2)}
            </span>
          </p>
          <p>
            Unit Cost:{" "}
            <span className="font-medium">${data.unit_cost.toFixed(2)}</span>
          </p>
        </div>
      </div>
    );
  }
  return null;
};

export function MarginAnalysisChart({
  data,
  period = "30 days",
  onPeriodChange,
}: MarginAnalysisChartProps) {
  const [viewMode, setViewMode] = useState<
    "revenue-margin" | "volume-margin" | "cost-margin"
  >("revenue-margin");
  const [highlightCategory, setHighlightCategory] = useState<
    "all" | "high" | "medium" | "low"
  >("all");

  // Prepare data for scatter chart based on view mode
  const chartData = data.map((item) => {
    let x, y;
    switch (viewMode) {
      case "revenue-margin":
        x = item.total_revenue;
        y = item.gross_margin_percentage;
        break;
      case "volume-margin":
        x = item.total_quantity_sold;
        y = item.gross_margin_percentage;
        break;
      case "cost-margin":
        x = item.unit_cost;
        y = item.gross_margin_percentage;
        break;
      default:
        x = item.total_revenue;
        y = item.gross_margin_percentage;
    }

    return {
      ...item,
      x,
      y,
      size: Math.max(item.total_revenue / 1000, 20), // Bubble size based on revenue
      category:
        item.gross_margin_percentage >= 40
          ? "high"
          : item.gross_margin_percentage >= 25
          ? "medium"
          : "low",
    };
  });

  const getAxisLabels = () => {
    switch (viewMode) {
      case "revenue-margin":
        return { x: "Total Revenue ($)", y: "Gross Margin (%)" };
      case "volume-margin":
        return { x: "Units Sold", y: "Gross Margin (%)" };
      case "cost-margin":
        return { x: "Unit Cost ($)", y: "Gross Margin (%)" };
      default:
        return { x: "Total Revenue ($)", y: "Gross Margin (%)" };
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "high":
        return "#10b981"; // green-500
      case "medium":
        return "#f59e0b"; // amber-500
      case "low":
        return "#ef4444"; // red-500
      default:
        return "#6b7280"; // gray-500
    }
  };

  const filteredData =
    highlightCategory === "all"
      ? chartData
      : chartData.filter((item) => item.category === highlightCategory);

  // Calculate summary statistics
  const totalRevenue = data.reduce((sum, item) => sum + item.total_revenue, 0);
  const totalProfit = data.reduce((sum, item) => sum + item.gross_profit, 0);
  const avgMargin =
    data.reduce((sum, item) => sum + item.gross_margin_percentage, 0) /
    data.length;
  const topPerformers = data.filter(
    (item) => item.gross_margin_percentage >= 40
  );
  const poorPerformers = data.filter(
    (item) => item.gross_margin_percentage < 15
  );

  const axisLabels = getAxisLabels();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Margin Analysis
            </CardTitle>
            <CardDescription>
              Product profitability analysis over {period}
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

            <Select
              value={viewMode}
              onValueChange={(value: any) => setViewMode(value)}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="revenue-margin">
                  Revenue vs Margin
                </SelectItem>
                <SelectItem value="volume-margin">Volume vs Margin</SelectItem>
                <SelectItem value="cost-margin">Cost vs Margin</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-2">
          <div className="flex gap-1">
            <Badge
              variant={highlightCategory === "all" ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setHighlightCategory("all")}
            >
              All ({data.length})
            </Badge>
            <Badge
              variant={highlightCategory === "high" ? "default" : "outline"}
              className="cursor-pointer bg-green-100 text-green-800 hover:bg-green-200"
              onClick={() => setHighlightCategory("high")}
            >
              High Margin ({topPerformers.length})
            </Badge>
            <Badge
              variant={highlightCategory === "medium" ? "default" : "outline"}
              className="cursor-pointer bg-amber-100 text-amber-800 hover:bg-amber-200"
              onClick={() => setHighlightCategory("medium")}
            >
              Medium Margin (
              {
                data.filter(
                  (item) =>
                    item.gross_margin_percentage >= 25 &&
                    item.gross_margin_percentage < 40
                ).length
              }
              )
            </Badge>
            <Badge
              variant={highlightCategory === "low" ? "destructive" : "outline"}
              className="cursor-pointer"
              onClick={() => setHighlightCategory("low")}
            >
              Low Margin ({poorPerformers.length})
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart
              data={filteredData}
              margin={{ top: 20, right: 20, bottom: 20, left: 40 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                type="number"
                dataKey="x"
                name={axisLabels.x}
                className="text-xs"
                tick={{ fill: "currentColor" }}
                tickFormatter={(value) =>
                  viewMode === "cost-margin"
                    ? `$${value.toFixed(2)}`
                    : value >= 1000
                    ? `${(value / 1000).toFixed(0)}k`
                    : value.toString()
                }
              />
              <YAxis
                type="number"
                dataKey="y"
                name={axisLabels.y}
                className="text-xs"
                tick={{ fill: "currentColor" }}
                tickFormatter={(value) => `${value.toFixed(0)}%`}
                domain={[0, "dataMax + 5"]}
              />
              <Tooltip content={<CustomTooltip />} />

              {/* Reference lines for margin benchmarks */}
              <ReferenceLine
                y={40}
                stroke="#10b981"
                strokeDasharray="3 3"
                opacity={0.7}
                label={{
                  value: "High Margin (40%+)",
                  position: "topRight",
                  className: "fill-green-600 text-xs font-medium",
                }}
              />
              <ReferenceLine
                y={25}
                stroke="#f59e0b"
                strokeDasharray="3 3"
                opacity={0.7}
                label={{
                  value: "Medium Margin (25%+)",
                  position: "topRight",
                  className: "fill-amber-600 text-xs font-medium",
                }}
              />
              <ReferenceLine
                y={15}
                stroke="#ef4444"
                strokeDasharray="3 3"
                opacity={0.7}
                label={{
                  value: "Low Margin (15%+)",
                  position: "topRight",
                  className: "fill-red-600 text-xs font-medium",
                }}
              />

              <Scatter name="Products" dataKey="y" fill="#8884d8">
                {filteredData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={getCategoryColor(entry.category)}
                    r={Math.min(Math.max(entry.size / 100, 3), 15)}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        {/* Summary Statistics */}
        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Total Revenue</p>
            <p className="text-lg font-semibold">
              ${totalRevenue.toLocaleString()}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Total Profit</p>
            <p className="text-lg font-semibold text-green-600">
              ${totalProfit.toLocaleString()}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Average Margin</p>
            <p className="text-lg font-semibold">{avgMargin.toFixed(1)}%</p>
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">High Performers</p>
            <p className="text-lg font-semibold">
              {topPerformers.length} products
            </p>
          </div>
        </div>

        {/* Top and Bottom Performers */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t">
          <div>
            <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600" />
              Top Profit Contributors
            </h4>
            <div className="space-y-2">
              {data
                .sort((a, b) => b.gross_profit - a.gross_profit)
                .slice(0, 3)
                .map((product, index) => (
                  <div
                    key={product.product_id}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        #{index + 1}
                      </span>
                      <span
                        className="font-medium truncate"
                        title={product.product_name}
                      >
                        {product.product_name.length > 20
                          ? `${product.product_name.substring(0, 20)}...`
                          : product.product_name}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-green-600">
                        ${product.gross_profit.toLocaleString()}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {product.gross_margin_percentage.toFixed(1)}% margin
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          <div>
            <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-600" />
              Lowest Margin Products
            </h4>
            <div className="space-y-2">
              {data
                .sort(
                  (a, b) =>
                    a.gross_margin_percentage - b.gross_margin_percentage
                )
                .slice(0, 3)
                .map((product, index) => (
                  <div
                    key={product.product_id}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        #{index + 1}
                      </span>
                      <span
                        className="font-medium truncate"
                        title={product.product_name}
                      >
                        {product.product_name.length > 20
                          ? `${product.product_name.substring(0, 20)}...`
                          : product.product_name}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-red-600">
                        {product.gross_margin_percentage.toFixed(1)}%
                      </div>
                      <div className="text-xs text-muted-foreground">
                        ${product.total_revenue.toLocaleString()} revenue
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 flex items-center justify-center gap-6 pt-4 border-t">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="text-sm text-muted-foreground">
              High Margin (40%+)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-500" />
            <span className="text-sm text-muted-foreground">
              Medium Margin (25-40%)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span className="text-sm text-muted-foreground">
              Low Margin (&lt;25%)
            </span>
          </div>
          <div className="text-sm text-muted-foreground">
            Bubble size = Revenue
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
