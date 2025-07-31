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
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  TooltipProps,
  ReferenceLine,
} from "recharts";
import { TrendingUp, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

interface SalesData {
  date: string;
  sales: number;
}

interface SalesChartProps {
  data: SalesData[];
}

const CustomTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
        <p className="font-medium text-sm">{label}</p>
        <p className="text-sm text-blue-600 dark:text-blue-400">
          Sales: <span className="font-bold">{payload[0].value} units</span>
        </p>
      </div>
    );
  }
  return null;
};

export function SalesChart({ data }: SalesChartProps) {
  const [dateRange, setDateRange] = useState("7d");
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);

  // Calculate average sales
  const avgSales = Math.round(
    data.reduce((sum, item) => sum + item.sales, 0) / data.length
  );

  // Find anomalies (sales significantly above or below average)
  const anomalyThreshold = avgSales * 0.3;
  const anomalies = data.filter(
    item => Math.abs(item.sales - avgSales) > anomalyThreshold
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Sales Trends
            </CardTitle>
            <CardDescription>
              Daily sales performance over time
            </CardDescription>
          </div>
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-32">
              <Calendar className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
              onMouseMove={(e) => {
                if (e && e.activeTooltipIndex !== undefined) {
                  setHoveredPoint(e.activeTooltipIndex);
                }
              }}
              onMouseLeave={() => setHoveredPoint(null)}
            >
              <CartesianGrid 
                strokeDasharray="3 3" 
                className="stroke-muted"
                vertical={false}
              />
              <XAxis 
                dataKey="date" 
                className="text-xs"
                tick={{ fill: 'currentColor' }}
                axisLine={{ stroke: 'currentColor', strokeWidth: 0.5 }}
              />
              <YAxis 
                className="text-xs"
                tick={{ fill: 'currentColor' }}
                axisLine={{ stroke: 'currentColor', strokeWidth: 0.5 }}
              />
              <Tooltip 
                content={<CustomTooltip />}
                cursor={{ stroke: 'rgba(59, 130, 246, 0.1)', strokeWidth: 2 }}
              />
              <ReferenceLine 
                y={avgSales} 
                stroke="currentColor"
                strokeDasharray="5 5"
                opacity={0.5}
                label={{
                  value: `Avg: ${avgSales}`,
                  position: "right",
                  className: "fill-muted-foreground text-xs",
                }}
              />
              <Line
                type="monotone"
                dataKey="sales"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={(props) => {
                  const { cx, cy, index } = props;
                  const isAnomaly = anomalies.some(
                    a => a.date === data[index].date
                  );
                  const isHovered = index === hoveredPoint;
                  
                  return (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={isAnomaly ? 6 : isHovered ? 5 : 3}
                      fill={isAnomaly ? "hsl(var(--destructive))" : "hsl(var(--primary))"}
                      stroke="white"
                      strokeWidth={2}
                      className={cn(
                        "transition-all duration-200",
                        isHovered && "drop-shadow-lg"
                      )}
                    />
                  );
                }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        
        {/* Summary Statistics */}
        <div className="mt-4 grid grid-cols-3 gap-4 pt-4 border-t">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Total Sales</p>
            <p className="text-lg font-semibold">
              {data.reduce((sum, item) => sum + item.sales, 0)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Average</p>
            <p className="text-lg font-semibold">{avgSales}/day</p>
          </div>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Trend</p>
            <p className="text-lg font-semibold text-green-600 dark:text-green-400">
              +12.5%
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}