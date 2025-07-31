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
  Legend,
} from "recharts";
import { Package, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface InventoryData {
  product: string;
  currentStock: number;
  lowStockThreshold: number;
}

interface InventoryChartProps {
  data: InventoryData[];
}

const CustomTooltip = ({ active, payload }: TooltipProps<number, string>) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload as InventoryData;
    const stockPercentage = Math.round(
      (data.currentStock / data.lowStockThreshold) * 100
    );
    
    return (
      <div className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
        <p className="font-medium text-sm mb-2">{data.product}</p>
        <div className="space-y-1">
          <p className="text-sm">
            Stock: <span className="font-bold">{data.currentStock} units</span>
          </p>
          <p className="text-sm">
            Threshold: <span className="font-bold">{data.lowStockThreshold} units</span>
          </p>
          <p className="text-sm">
            Status: {" "}
            <span className={cn(
              "font-bold",
              stockPercentage < 100 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"
            )}>
              {stockPercentage < 100 ? "Low Stock" : "Normal"}
            </span>
          </p>
        </div>
      </div>
    );
  }
  return null;
};

export function InventoryChart({ data }: InventoryChartProps) {
  const [filter, setFilter] = useState<"all" | "low" | "normal">("all");
  const [hoveredBar, setHoveredBar] = useState<string | null>(null);

  const filteredData = data.filter(item => {
    if (filter === "all") return true;
    if (filter === "low") return item.currentStock < item.lowStockThreshold;
    if (filter === "normal") return item.currentStock >= item.lowStockThreshold;
    return true;
  });

  const getBarColor = (item: InventoryData) => {
    const percentage = (item.currentStock / item.lowStockThreshold) * 100;
    if (percentage < 50) return "hsl(var(--destructive))";
    if (percentage < 100) return "hsl(var(--warning))";
    return "hsl(var(--success))";
  };

  const lowStockCount = data.filter(
    item => item.currentStock < item.lowStockThreshold
  ).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Inventory Levels
            </CardTitle>
            <CardDescription>
              Current stock levels by product
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
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
                variant={filter === "low" ? "destructive" : "outline"}
                className="cursor-pointer"
                onClick={() => setFilter("low")}
              >
                Low ({lowStockCount})
              </Badge>
              <Badge
                variant={filter === "normal" ? "secondary" : "outline"}
                className="cursor-pointer"
                onClick={() => setFilter("normal")}
              >
                Normal ({data.length - lowStockCount})
              </Badge>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={filteredData}
              margin={{ top: 20, right: 5, left: 5, bottom: 5 }}
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
                dataKey="product"
                className="text-xs"
                tick={{ fill: 'currentColor' }}
                angle={-45}
                textAnchor="end"
                height={80}
              />
              <YAxis
                className="text-xs"
                tick={{ fill: 'currentColor' }}
                label={{
                  value: "Units",
                  angle: -90,
                  position: "insideLeft",
                  className: "fill-muted-foreground text-xs",
                }}
              />
              <Tooltip content={<CustomTooltip />} />
              
              {/* Threshold lines for each product */}
              {filteredData.map((item, index) => (
                <ReferenceLine
                  key={`threshold-${index}`}
                  x={item.product}
                  y={item.lowStockThreshold}
                  stroke="hsl(var(--destructive))"
                  strokeDasharray="3 3"
                  opacity={0.5}
                  isFront={false}
                />
              ))}
              
              <Bar
                dataKey="currentStock"
                radius={[4, 4, 0, 0]}
              >
                {filteredData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={getBarColor(entry)}
                    className={cn(
                      "transition-opacity duration-200",
                      hoveredBar && hoveredBar !== entry.product && "opacity-50"
                    )}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        
        {/* Legend */}
        <div className="mt-4 flex items-center justify-center gap-6 pt-4 border-t">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-green-500" />
            <span className="text-sm text-muted-foreground">Normal Stock</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-amber-500" />
            <span className="text-sm text-muted-foreground">Low Stock</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-red-500" />
            <span className="text-sm text-muted-foreground">Critical</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-12 h-0.5 border-t-2 border-dashed border-red-500" />
            <span className="text-sm text-muted-foreground">Threshold</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}