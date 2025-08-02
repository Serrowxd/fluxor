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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
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
import { TrendingUp, Calendar, MessageCircle, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChat } from "@/hooks/useChat";

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

export function SalesChartWithChat({ data }: SalesChartProps) {
  const [dateRange, setDateRange] = useState("7d");
  const [hoveredPoint, setHoveredPoint] = useState<number | null>(null);
  const { setIsOpen, sendMessage } = useChat();

  // Calculate average sales
  const avgSales = Math.round(
    data.reduce((sum, item) => sum + item.sales, 0) / data.length
  );

  // Find anomalies (sales significantly above or below average)
  const anomalyThreshold = avgSales * 0.3;
  const anomalies = data.filter(
    item => Math.abs(item.sales - avgSales) > anomalyThreshold
  );

  // Calculate trend
  const firstHalf = data.slice(0, Math.floor(data.length / 2));
  const secondHalf = data.slice(Math.floor(data.length / 2));
  const firstHalfAvg = firstHalf.reduce((sum, item) => sum + item.sales, 0) / firstHalf.length;
  const secondHalfAvg = secondHalf.reduce((sum, item) => sum + item.sales, 0) / secondHalf.length;
  const trendPercentage = ((secondHalfAvg - firstHalfAvg) / firstHalfAvg * 100).toFixed(1);
  const isUpward = secondHalfAvg > firstHalfAvg;

  const openChatWithContext = (question: string, context?: any) => {
    setIsOpen(true);
    setTimeout(() => {
      sendMessage(question, context);
    }, 100);
  };

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
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant="outline"
                  size="sm"
                  className="bg-blue-900/20 hover:bg-blue-900/30 border-blue-500/30"
                >
                  <MessageCircle className="mr-2 h-4 w-4 text-blue-400" />
                  <span className="text-blue-300">Ask AI</span>
                  <ChevronDown className="ml-1 h-3 w-3 text-blue-400" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="bg-gray-800 border-gray-700">
                <DropdownMenuItem 
                  onClick={() => openChatWithContext(
                    'What\'s driving my sales trends?',
                    { 
                      chartType: 'sales',
                      data: data,
                      trend: isUpward ? 'upward' : 'downward',
                      trendPercentage: trendPercentage,
                      avgSales: avgSales
                    }
                  )}
                >
                  What&apos;s driving my sales trends?
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => openChatWithContext(
                    'Why did sales spike on certain days?',
                    { 
                      chartType: 'sales',
                      anomalies: anomalies,
                      avgSales: avgSales
                    }
                  )}
                >
                  Why did sales spike on certain days?
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => openChatWithContext(
                    'What are my sales patterns telling me?',
                    { 
                      chartType: 'sales',
                      data: data,
                      dateRange: dateRange
                    }
                  )}
                >
                  What are my sales patterns telling me?
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={() => openChatWithContext(
                    'How can I improve my sales performance?',
                    { 
                      chartType: 'sales',
                      currentAvg: avgSales,
                      trend: trendPercentage
                    }
                  )}
                >
                  How can I improve my sales performance?
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
            <p className={cn(
              "text-lg font-semibold",
              isUpward ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
            )}>
              {isUpward ? '+' : ''}{trendPercentage}%
            </p>
          </div>
        </div>

        {/* AI Insights Prompt */}
        {anomalies.length > 0 && (
          <div className="mt-4 p-3 bg-blue-900/20 rounded-lg border border-blue-500/30">
            <div className="flex items-start gap-2">
              <MessageCircle className="h-4 w-4 text-blue-300 mt-0.5 flex-shrink-0" />
              <div className="flex-1 space-y-1">
                <p className="text-sm text-blue-100">
                  Detected {anomalies.length} unusual sales {anomalies.length === 1 ? 'day' : 'days'}.
                </p>
                <button
                  onClick={() => openChatWithContext(
                    `What caused the sales spike on ${anomalies[0].date}?`,
                    { 
                      date: anomalies[0].date,
                      sales: anomalies[0].sales,
                      avgSales: avgSales,
                      allAnomalies: anomalies
                    }
                  )}
                  className="text-sm text-blue-300 hover:text-blue-100 underline"
                >
                  Ask AI for analysis
                </button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}