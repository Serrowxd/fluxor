"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  TrendingUp,
  TrendingDown,
  AlertCircle,
  DollarSign,
  Package,
  Target,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AnalyticsSummary {
  totalProducts: number;
  criticalStockProducts: number;
  lowStockProducts: number;
  overstockProducts: number;
  totalInventoryValue: number;
  totalCarryingCost: number;
  carryingCostPercentage: number;
  avgTurnoverRatio: number;
  totalLostRevenue: number;
  avgStockoutRate: number;
  avgGrossMargin: number;
}

interface AnalyticsOverviewProps {
  data: AnalyticsSummary;
  isLoading?: boolean;
  className?: string;
}

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: {
    value: number;
    direction: "up" | "down" | "neutral";
    isGood?: boolean;
  };
  color: "green" | "red" | "yellow" | "blue" | "gray";
  format?: "currency" | "percentage" | "number";
}

const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  color,
  format = "number",
}) => {
  const formatValue = (val: string | number) => {
    const numVal = typeof val === "string" ? parseFloat(val) : val;

    switch (format) {
      case "currency":
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
        }).format(numVal);
      case "percentage":
        return `${numVal.toFixed(1)}%`;
      default:
        return typeof val === "number" ? val.toLocaleString() : val;
    }
  };

  const getTrendIcon = () => {
    if (!trend) return null;

    switch (trend.direction) {
      case "up":
        return <ArrowUpRight className="h-4 w-4" />;
      case "down":
        return <ArrowDownRight className="h-4 w-4" />;
      default:
        return <Minus className="h-4 w-4" />;
    }
  };

  const getTrendColor = () => {
    if (!trend) return "";

    if (trend.direction === "neutral") return "text-gray-500";

    const isPositive = trend.direction === "up";
    const shouldBeGood = trend.isGood !== undefined ? trend.isGood : isPositive;

    return shouldBeGood ? "text-green-600" : "text-red-600";
  };

  const colorClasses = {
    green:
      "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950",
    red: "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950",
    yellow:
      "border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950",
    blue: "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950",
    gray: "border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-950",
  };

  const iconColorClasses = {
    green: "text-green-600 dark:text-green-400",
    red: "text-red-600 dark:text-red-400",
    yellow: "text-yellow-600 dark:text-yellow-400",
    blue: "text-blue-600 dark:text-blue-400",
    gray: "text-gray-600 dark:text-gray-400",
  };

  return (
    <Card className={cn("transition-all hover:shadow-md", colorClasses[color])}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between space-y-0 pb-2">
          <div className="text-sm font-medium text-muted-foreground">
            {title}
          </div>
          <Icon className={cn("h-4 w-4", iconColorClasses[color])} />
        </div>
        <div className="space-y-1">
          <div className="text-2xl font-bold">{formatValue(value)}</div>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
          {trend && (
            <div
              className={cn(
                "flex items-center text-xs font-medium",
                getTrendColor()
              )}
            >
              {getTrendIcon()}
              <span className="ml-1">
                {Math.abs(trend.value)}% from last period
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export function AnalyticsOverview({
  data,
  isLoading = false,
  className,
}: AnalyticsOverviewProps) {
  const [benchmarks, setBenchmarks] = useState<any>(null);

  useEffect(() => {
    // Load benchmarks for comparison
    // This would come from the API in a real implementation
    setBenchmarks({
      inventoryTurnover: { excellent: 6, good: 4, fair: 2 },
      stockoutRate: { excellent: 2, good: 5, fair: 10 },
      grossMargin: { excellent: 40, good: 25, fair: 15 },
      carryingCost: { excellent: 15, good: 25, fair: 35 },
    });
  }, []);

  if (isLoading) {
    return (
      <div className={cn("space-y-6", className)}>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Card key={index}>
              <CardContent className="p-6">
                <div className="animate-pulse space-y-3">
                  <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                  <div className="h-8 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/3"></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const getPerformanceColor = (value: number, thresholds: any) => {
    if (!thresholds) return "gray";
    if (value >= thresholds.excellent) return "green";
    if (value >= thresholds.good) return "yellow";
    if (value >= thresholds.fair) return "orange";
    return "red";
  };

  const getStockAlertLevel = () => {
    const alertProducts = data.criticalStockProducts + data.lowStockProducts;
    const percentage = (alertProducts / data.totalProducts) * 100;

    if (percentage <= 10) return "green";
    if (percentage <= 25) return "yellow";
    return "red";
  };

  return (
    <div className={cn("space-y-6", className)}>
      {/* Key Performance Indicators */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Inventory Turnover"
          value={data.avgTurnoverRatio}
          subtitle={`${
            data.avgTurnoverRatio >= 6
              ? "Excellent"
              : data.avgTurnoverRatio >= 4
              ? "Good"
              : data.avgTurnoverRatio >= 2
              ? "Fair"
              : "Needs Improvement"
          } performance`}
          icon={TrendingUp}
          color={
            benchmarks
              ? getPerformanceColor(
                  data.avgTurnoverRatio,
                  benchmarks.inventoryTurnover
                )
              : "gray"
          }
          format="number"
          trend={{
            value: 5.2,
            direction: "up",
            isGood: true,
          }}
        />

        <MetricCard
          title="Stockout Rate"
          value={data.avgStockoutRate}
          subtitle={`${
            data.totalLostRevenue > 0
              ? `$${data.totalLostRevenue.toLocaleString()} lost revenue`
              : "No lost revenue"
          }`}
          icon={AlertCircle}
          color={
            data.avgStockoutRate <= 2
              ? "green"
              : data.avgStockoutRate <= 5
              ? "yellow"
              : "red"
          }
          format="percentage"
          trend={{
            value: 1.8,
            direction: "down",
            isGood: true,
          }}
        />

        <MetricCard
          title="Gross Margin"
          value={data.avgGrossMargin}
          subtitle={`Average across all products`}
          icon={DollarSign}
          color={
            data.avgGrossMargin >= 40
              ? "green"
              : data.avgGrossMargin >= 25
              ? "yellow"
              : "red"
          }
          format="percentage"
          trend={{
            value: 2.3,
            direction: "up",
            isGood: true,
          }}
        />

        <MetricCard
          title="Carrying Cost"
          value={data.carryingCostPercentage}
          subtitle={`$${data.totalCarryingCost.toLocaleString()} total cost`}
          icon={Package}
          color={
            data.carryingCostPercentage <= 15
              ? "green"
              : data.carryingCostPercentage <= 25
              ? "yellow"
              : "red"
          }
          format="percentage"
          trend={{
            value: 0.7,
            direction: "down",
            isGood: true,
          }}
        />
      </div>

      {/* Stock Status Overview */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Stock Status Overview
            </CardTitle>
            <CardDescription>
              Current inventory levels across all products
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Total Products</span>
                <span className="text-2xl font-bold">{data.totalProducts}</span>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                    <span className="text-sm">Critical Stock</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {data.criticalStockProducts}
                    </span>
                    <Badge variant="destructive" className="text-xs">
                      {(
                        (data.criticalStockProducts / data.totalProducts) *
                        100
                      ).toFixed(1)}
                      %
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                    <span className="text-sm">Low Stock</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {data.lowStockProducts}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {(
                        (data.lowStockProducts / data.totalProducts) *
                        100
                      ).toFixed(1)}
                      %
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                    <span className="text-sm">Overstock</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {data.overstockProducts}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {(
                        (data.overstockProducts / data.totalProducts) *
                        100
                      ).toFixed(1)}
                      %
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                    <span className="text-sm">Normal Stock</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {data.totalProducts -
                        data.criticalStockProducts -
                        data.lowStockProducts -
                        data.overstockProducts}
                    </span>
                    <Badge
                      variant="secondary"
                      className="text-xs text-green-700 bg-green-100"
                    >
                      {(
                        ((data.totalProducts -
                          data.criticalStockProducts -
                          data.lowStockProducts -
                          data.overstockProducts) /
                          data.totalProducts) *
                        100
                      ).toFixed(1)}
                      %
                    </Badge>
                  </div>
                </div>
              </div>

              <Progress
                value={
                  ((data.totalProducts -
                    data.criticalStockProducts -
                    data.lowStockProducts) /
                    data.totalProducts) *
                  100
                }
                className="h-2"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Financial Overview
            </CardTitle>
            <CardDescription>Total inventory value and costs</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  Total Inventory Value
                </span>
                <span className="text-2xl font-bold">
                  ${data.totalInventoryValue.toLocaleString()}
                </span>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Carrying Costs
                  </span>
                  <div className="text-right">
                    <div className="text-sm font-medium">
                      ${data.totalCarryingCost.toLocaleString()}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {data.carryingCostPercentage.toFixed(1)}% of inventory
                      value
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Lost Revenue (Stockouts)
                  </span>
                  <div className="text-right">
                    <div className="text-sm font-medium text-red-600">
                      ${data.totalLostRevenue.toLocaleString()}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Last 30 days
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Avg. Gross Margin
                  </span>
                  <div className="text-right">
                    <div className="text-sm font-medium text-green-600">
                      {data.avgGrossMargin.toFixed(1)}%
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Across all products
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
