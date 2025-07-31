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
  ReferenceLine,
  TooltipProps,
  Area,
  AreaChart,
} from "recharts";
import { AlertCircle, TrendingDown, Clock, DollarSign } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface StockoutData {
  product_id: string;
  product_name: string;
  sku: string;
  stockout_events: number;
  total_stockout_hours: number;
  lost_sales: number;
  lost_revenue: number;
  stockout_days: number;
  total_orders: number;
  total_demand_quantity: number;
  stockout_rate_percent: number;
  lost_sales_rate_percent: number;
}

interface StockoutTrackerProps {
  data: StockoutData[];
  period?: string;
  onPeriodChange?: (period: string) => void;
  timeSeriesData?: Array<{
    date: string;
    stockout_events: number;
    lost_revenue: number;
    affected_products: number;
  }>;
}

const CustomTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    
    return (
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
        <p className="font-medium text-sm mb-2">{label}</p>
        <div className="space-y-1 text-xs">
          {payload.map((entry, index) => (
            <p key={index} style={{ color: entry.color }}>
              {entry.name}: <span className="font-bold">{entry.value}</span>
              {entry.name.includes('Revenue') && '$'}
              {entry.name.includes('Rate') && '%'}
            </p>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

const ProductTooltip = ({ active, payload }: TooltipProps<number, string>) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload as StockoutData;
    
    return (
      <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
        <p className="font-medium text-sm mb-2">{data.product_name}</p>
        <div className="space-y-1 text-xs">
          <p>SKU: <span className="font-medium">{data.sku}</span></p>
          <p>Stockout Rate: <span className="font-bold text-red-600">{data.stockout_rate_percent.toFixed(1)}%</span></p>
          <p>Stockout Events: <span className="font-medium">{data.stockout_events}</span></p>
          <p>Total Hours: <span className="font-medium">{data.total_stockout_hours.toLocaleString()}</span></p>
          <p>Lost Sales: <span className="font-medium">{data.lost_sales} units</span></p>
          <p>Lost Revenue: <span className="font-bold text-red-600">${data.lost_revenue.toLocaleString()}</span></p>
          <p>Lost Sales Rate: <span className="font-medium">{data.lost_sales_rate_percent.toFixed(1)}%</span></p>
        </div>
      </div>
    );
  }
  return null;
};

export function StockoutTracker({ 
  data, 
  period = "30 days",
  onPeriodChange,
  timeSeriesData = []
}: StockoutTrackerProps) {
  const [viewMode, setViewMode] = useState<"overview" | "products" | "timeline">("overview");

  // Calculate summary metrics
  const totalStockoutEvents = data.reduce((sum, item) => sum + item.stockout_events, 0);
  const totalLostRevenue = data.reduce((sum, item) => sum + item.lost_revenue, 0);
  const totalLostSales = data.reduce((sum, item) => sum + item.lost_sales, 0);
  const affectedProducts = data.filter(item => item.stockout_events > 0).length;
  const avgStockoutRate = data.length > 0 
    ? data.reduce((sum, item) => sum + item.stockout_rate_percent, 0) / data.length 
    : 0;

  // Get worst performers
  const worstPerformers = data
    .filter(item => item.stockout_events > 0)
    .sort((a, b) => b.lost_revenue - a.lost_revenue)
    .slice(0, 5);

  // Get high-risk products (high stockout rate)
  const highRiskProducts = data
    .filter(item => item.stockout_rate_percent > 10)
    .sort((a, b) => b.stockout_rate_percent - a.stockout_rate_percent);

  const getStockoutSeverity = (rate: number) => {
    if (rate <= 2) return { level: "low", color: "green" };
    if (rate <= 5) return { level: "medium", color: "yellow" };
    if (rate <= 10) return { level: "high", color: "orange" };
    return { level: "critical", color: "red" };
  };

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <div className="text-sm font-medium text-muted-foreground">Total Stockouts</div>
              <AlertCircle className="h-4 w-4 text-red-600" />
            </div>
            <div className="text-2xl font-bold">{totalStockoutEvents}</div>
            <p className="text-xs text-muted-foreground">
              {affectedProducts} products affected
            </p>
          </CardContent>
        </Card>

        <Card className="border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <div className="text-sm font-medium text-muted-foreground">Lost Revenue</div>
              <DollarSign className="h-4 w-4 text-red-600" />
            </div>
            <div className="text-2xl font-bold">${totalLostRevenue.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              {totalLostSales} units lost
            </p>
          </CardContent>
        </Card>

        <Card className="border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950">
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <div className="text-sm font-medium text-muted-foreground">Avg Stockout Rate</div>
              <TrendingDown className="h-4 w-4 text-orange-600" />
            </div>
            <div className="text-2xl font-bold">{avgStockoutRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">
              {getStockoutSeverity(avgStockoutRate).level} severity
            </p>
          </CardContent>
        </Card>

        <Card className="border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950">
          <CardContent className="p-6">
            <div className="flex items-center justify-between space-y-0 pb-2">
              <div className="text-sm font-medium text-muted-foreground">High Risk Products</div>
              <Clock className="h-4 w-4 text-yellow-600" />
            </div>
            <div className="text-2xl font-bold">{highRiskProducts.length}</div>
            <p className="text-xs text-muted-foreground">
              >10% stockout rate
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Timeline Chart */}
      {timeSeriesData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Stockout Trends Over Time</CardTitle>
            <CardDescription>Daily stockout events and lost revenue</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeSeriesData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="date" 
                    className="text-xs"
                    tick={{ fill: 'currentColor' }}
                  />
                  <YAxis 
                    yAxisId="events"
                    className="text-xs"
                    tick={{ fill: 'currentColor' }}
                  />
                  <YAxis 
                    yAxisId="revenue"
                    orientation="right"
                    className="text-xs"
                    tick={{ fill: 'currentColor' }}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    yAxisId="events"
                    type="monotone"
                    dataKey="stockout_events"
                    stackId="1"
                    stroke="#ef4444"
                    fill="#ef4444"
                    fillOpacity={0.3}
                    name="Stockout Events"
                  />
                  <Line
                    yAxisId="revenue"
                    type="monotone"
                    dataKey="lost_revenue"
                    stroke="#dc2626"
                    strokeWidth={2}
                    dot={false}
                    name="Lost Revenue ($)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Worst Performers */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Highest Revenue Impact</CardTitle>
            <CardDescription>Products with most lost revenue</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {worstPerformers.map((product, index) => (
                <div key={product.product_id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">#{index + 1}</span>
                    <div>
                      <div className="font-medium text-sm">{product.product_name}</div>
                      <div className="text-xs text-muted-foreground">{product.sku}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-red-600">
                      ${product.lost_revenue.toLocaleString()}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {product.stockout_events} events
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Highest Risk Products</CardTitle>
            <CardDescription>Products with highest stockout rates</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {highRiskProducts.slice(0, 5).map((product, index) => (
                <div key={product.product_id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">#{index + 1}</span>
                    <div>
                      <div className="font-medium text-sm">{product.product_name}</div>
                      <div className="text-xs text-muted-foreground">{product.sku}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-red-600">
                      {product.stockout_rate_percent.toFixed(1)}%
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {product.total_stockout_hours}h total
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  const renderProducts = () => (
    <div className="space-y-4">
      {data.filter(item => item.stockout_events > 0).map((product) => (
        <Card key={product.product_id} className="border-red-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-medium">{product.product_name}</h3>
                <p className="text-sm text-muted-foreground">{product.sku}</p>
              </div>
              <Badge 
                variant={product.stockout_rate_percent > 10 ? "destructive" : "outline"}
              >
                {product.stockout_rate_percent.toFixed(1)}% stockout rate
              </Badge>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Events</div>
                <div className="font-medium">{product.stockout_events}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Lost Sales</div>
                <div className="font-medium">{product.lost_sales} units</div>
              </div>
              <div>
                <div className="text-muted-foreground">Lost Revenue</div>
                <div className="font-medium text-red-600">${product.lost_revenue.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Total Hours</div>
                <div className="font-medium">{product.total_stockout_hours}h</div>
              </div>
            </div>
            
            <div className="mt-3">
              <div className="flex justify-between text-sm mb-1">
                <span>Lost Sales Rate</span>
                <span>{product.lost_sales_rate_percent.toFixed(1)}%</span>
              </div>
              <Progress 
                value={Math.min(product.lost_sales_rate_percent, 100)} 
                className={cn(
                  "h-2",
                  product.lost_sales_rate_percent > 20 ? "bg-red-100" : 
                  product.lost_sales_rate_percent > 10 ? "bg-orange-100" : "bg-yellow-100"
                )}
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-600" />
              Stockout Tracking
            </CardTitle>
            <CardDescription>
              Monitor stockout events and lost revenue over {period}
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
                </SelectContent>
              </Select>
            )}
            
            <Select value={viewMode} onValueChange={(value: any) => setViewMode(value)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="overview">Overview</SelectItem>
                <SelectItem value="products">Products</SelectItem>
                <SelectItem value="timeline">Timeline</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {viewMode === "overview" && renderOverview()}
        {viewMode === "products" && renderProducts()}
        {viewMode === "timeline" && timeSeriesData.length > 0 && (
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timeSeriesData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="date" 
                  className="text-xs"
                  tick={{ fill: 'currentColor' }}
                />
                <YAxis 
                  className="text-xs"
                  tick={{ fill: 'currentColor' }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="stockout_events"
                  stroke="#ef4444"
                  strokeWidth={2}
                  name="Stockout Events"
                />
                <Line
                  type="monotone"
                  dataKey="affected_products"
                  stroke="#f97316"
                  strokeWidth={2}
                  name="Affected Products"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}