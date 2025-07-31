"use client";

import { useEffect, useState } from "react";
import { SalesChart } from "@/components/dashboard/sales-chart";
import { InventoryChart } from "@/components/dashboard/inventory-chart";
import { ReorderSuggestions } from "@/components/dashboard/reorder-suggestions";
import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";
import { AlertBanner, AlertItem } from "@/components/dashboard/alert-banner";
import { SyncStatus } from "@/components/dashboard/sync-status";
import { AnalyticsOverview } from "@/components/dashboard/analytics-overview";
import { TurnoverChart } from "@/components/dashboard/turnover-chart";
import { MarginAnalysisChart } from "@/components/dashboard/margin-analysis-chart";
import { StockoutTracker } from "@/components/dashboard/stockout-tracker";
import { Button } from "@/components/ui/button";
import { RefreshCw, Store, Download, FileText } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

export default function Content() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [salesData, setSalesData] = useState([]);
  const [inventoryData, setInventoryData] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [hasStore, setHasStore] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [lastSyncTime, setLastSyncTime] = useState<Date | undefined>();
  const [syncProgress, setSyncProgress] = useState<number | undefined>();
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // Check if this is a dev or demo user
  const isDevUser = user?.user_id === "dev-user-123";
  const isDemoUser = user?.user_id === "demo-user-456";
  const isDemoOrDevUser = isDevUser || isDemoUser;

  useEffect(() => {
    if (isDemoOrDevUser) {
      // Load dummy data for development or demo
      loadDummyData();
    } else {
      // Load real data from API
      fetchDashboardData();
    }
  }, [isDemoOrDevUser]);

  // Generate alerts based on inventory data
  useEffect(() => {
    const newAlerts: AlertItem[] = [];

    // Check for low stock items
    const lowStockItems = suggestions.filter((s) => s.urgency === "high");
    if (lowStockItems.length > 0) {
      newAlerts.push({
        id: "low-stock",
        type: "reorder",
        message: `${lowStockItems.length} products need immediate reordering`,
        link: "#",
        linkText: "View Reorder Suggestions",
        priority: "high",
      });
    }

    // Check for medium urgency items
    const mediumUrgencyItems = suggestions.filter(
      (s) => s.urgency === "medium"
    );
    if (mediumUrgencyItems.length > 0) {
      newAlerts.push({
        id: "medium-stock",
        type: "stock",
        message: `${mediumUrgencyItems.length} products will need reordering soon`,
        priority: "medium",
      });
    }

    setAlerts(newAlerts);
  }, [suggestions]);

  const loadDummyData = () => {
    // Set dummy data for development
    setHasStore(true);
    setLastSyncTime(new Date(Date.now() - 2 * 60 * 60 * 1000)); // 2 hours ago

    // Generate sales data for the last 30 days
    const salesTrend = [];
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      salesTrend.push({
        date: date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        sales: Math.floor(Math.random() * 200) + 100,
      });
    }
    setSalesData(salesTrend.slice(-7)); // Show last 7 days

    // Generate dummy analytics data
    setAnalyticsData({
      summary: {
        totalProducts: 45,
        criticalStockProducts: 3,
        lowStockProducts: 7,
        overstockProducts: 2,
        totalInventoryValue: 125000,
        totalCarryingCost: 15750,
        carryingCostPercentage: 12.6,
        avgTurnoverRatio: 4.8,
        totalLostRevenue: 8500,
        avgStockoutRate: 3.2,
        avgGrossMargin: 32.5,
      },
      details: {
        turnover: [
          {
            product_id: "1",
            product_name: "Classic T-Shirt",
            sku: "TSH-CLS-M",
            cogs: 15000,
            avg_inventory_value: 2500,
            turnover_ratio: 6.0,
            performance_category: "excellent",
            transaction_count: 156,
          },
          {
            product_id: "2",
            product_name: "Denim Jeans",
            sku: "JNS-BLU-32",
            cogs: 12000,
            avg_inventory_value: 4000,
            turnover_ratio: 3.0,
            performance_category: "fair",
            transaction_count: 89,
          },
          {
            product_id: "3",
            product_name: "Winter Jacket",
            sku: "JKT-WIN-L",
            cogs: 8000,
            avg_inventory_value: 5000,
            turnover_ratio: 1.6,
            performance_category: "poor",
            transaction_count: 34,
          },
        ],
        margins: [
          {
            product_id: "1",
            product_name: "Classic T-Shirt",
            sku: "TSH-CLS-M",
            unit_cost: 8.5,
            selling_price: 24.99,
            avg_selling_price: 23.5,
            total_quantity_sold: 156,
            total_revenue: 3666,
            total_cost: 1326,
            gross_profit: 2340,
            gross_margin_percentage: 63.8,
            list_price_margin_percentage: 66.0,
            avg_revenue_per_unit: 23.5,
          },
          {
            product_id: "2",
            product_name: "Denim Jeans",
            sku: "JNS-BLU-32",
            unit_cost: 28.0,
            selling_price: 79.99,
            avg_selling_price: 75.0,
            total_quantity_sold: 89,
            total_revenue: 6675,
            total_cost: 2492,
            gross_profit: 4183,
            gross_margin_percentage: 62.7,
            list_price_margin_percentage: 65.0,
            avg_revenue_per_unit: 75.0,
          },
          {
            product_id: "3",
            product_name: "Winter Jacket",
            sku: "JKT-WIN-L",
            unit_cost: 45.0,
            selling_price: 159.99,
            avg_selling_price: 140.0,
            total_quantity_sold: 34,
            total_revenue: 4760,
            total_cost: 1530,
            gross_profit: 3230,
            gross_margin_percentage: 67.9,
            list_price_margin_percentage: 71.9,
            avg_revenue_per_unit: 140.0,
          },
        ],
        stockouts: [
          {
            product_id: "2",
            product_name: "Denim Jeans",
            sku: "JNS-BLU-32",
            stockout_events: 3,
            total_stockout_hours: 72,
            lost_sales: 15,
            lost_revenue: 1125,
            stockout_days: 3,
            total_orders: 89,
            total_demand_quantity: 104,
            stockout_rate_percent: 3.4,
            lost_sales_rate_percent: 14.4,
          },
          {
            product_id: "3",
            product_name: "Winter Jacket",
            sku: "JKT-WIN-L",
            stockout_events: 2,
            total_stockout_hours: 48,
            lost_sales: 8,
            lost_revenue: 1120,
            stockout_days: 2,
            total_orders: 34,
            total_demand_quantity: 42,
            stockout_rate_percent: 5.9,
            lost_sales_rate_percent: 19.0,
          },
        ],
      },
    });

    // Set inventory data with various stock levels
    setInventoryData([
      { product: "Classic T-Shirt", currentStock: 45, lowStockThreshold: 20 },
      { product: "Denim Jeans", currentStock: 15, lowStockThreshold: 25 },
      { product: "Running Sneakers", currentStock: 30, lowStockThreshold: 15 },
      { product: "Baseball Cap", currentStock: 60, lowStockThreshold: 10 },
      { product: "Winter Jacket", currentStock: 8, lowStockThreshold: 20 },
      { product: "Leather Wallet", currentStock: 35, lowStockThreshold: 15 },
      { product: "Sunglasses", currentStock: 12, lowStockThreshold: 20 },
      { product: "Backpack", currentStock: 25, lowStockThreshold: 10 },
    ]);

    // Set reorder suggestions with urgency levels
    setSuggestions([
      {
        productId: "1",
        productName: "Denim Jeans",
        sku: "JNS-BLU-32",
        currentStock: 15,
        predictedDemand: 45,
        suggestedReorderAmount: 30,
        urgency: "high",
        lastReorderDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        supplierLeadTime: 7,
      },
      {
        productId: "2",
        productName: "Winter Jacket",
        sku: "JKT-WIN-L",
        currentStock: 8,
        predictedDemand: 35,
        suggestedReorderAmount: 27,
        urgency: "high",
        lastReorderDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
        supplierLeadTime: 14,
      },
      {
        productId: "3",
        productName: "Sunglasses",
        sku: "SUN-POL-BLK",
        currentStock: 12,
        predictedDemand: 30,
        suggestedReorderAmount: 18,
        urgency: "medium",
        lastReorderDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
        supplierLeadTime: 5,
      },
      {
        productId: "4",
        productName: "Classic T-Shirt",
        sku: "TSH-CLS-M",
        currentStock: 45,
        predictedDemand: 60,
        suggestedReorderAmount: 15,
        urgency: "low",
        lastReorderDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        supplierLeadTime: 3,
      },
    ]);

    setLoading(false);
  };

  const fetchDashboardData = async () => {
    try {
      // Check if user has connected store
      const storesResponse = await fetch(
        "http://localhost:3001/api/shopify/stores",
        {
          credentials: "include",
        }
      );
      const storesData = await storesResponse.json();

      if (storesData.stores && storesData.stores.length > 0) {
        setHasStore(true);
        setLastSyncTime(new Date());

        // Fetch inventory data
        const inventoryResponse = await fetch(
          "http://localhost:3001/api/inventory",
          {
            credentials: "include",
          }
        );
        const inventory = await inventoryResponse.json();

        // Fetch forecast data
        const forecastResponse = await fetch(
          "http://localhost:3001/api/forecast",
          {
            credentials: "include",
          }
        );
        const forecasts = await forecastResponse.json();

        // For now, still use some mock data until backend is fully implemented
        loadDummyData();
      }
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
      toast({
        title: "Error",
        description: "Failed to load dashboard data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncProgress(0);

    if (isDemoOrDevUser) {
      // Simulate sync for demo or dev user
      const interval = setInterval(() => {
        setSyncProgress((prev) => {
          if (prev === undefined || prev >= 100) {
            clearInterval(interval);
            return 100;
          }
          return prev + 10;
        });
      }, 200);

      setTimeout(() => {
        toast({
          title: "Sync Complete",
          description: isDevUser
            ? "Development data has been refreshed"
            : "Demo data has been refreshed",
        });
        loadDummyData();
        setSyncing(false);
        setSyncProgress(undefined);
        setLastSyncTime(new Date());
      }, 2000);
    } else {
      try {
        const response = await fetch(
          "http://localhost:3001/api/inventory/sync",
          {
            method: "POST",
            credentials: "include",
          }
        );

        if (response.ok) {
          toast({
            title: "Sync Started",
            description:
              "Inventory sync has been queued and will complete shortly",
          });
          // Refresh data after a delay
          setTimeout(fetchDashboardData, 5000);
          setLastSyncTime(new Date());
        }
      } catch (error) {
        toast({
          title: "Sync Failed",
          description: "Failed to start inventory sync",
          variant: "destructive",
        });
      } finally {
        setSyncing(false);
        setSyncProgress(undefined);
      }
    }
  };

  const handleReorder = (productId: string) => {
    const product = suggestions.find((s) => s.productId === productId);
    toast({
      title: "Reorder Initiated",
      description: `Reorder process has been started for ${
        product?.productName || "this product"
      }`,
    });
  };

  const handleAlertDismiss = (alertId: string) => {
    setAlerts(alerts.filter((a) => a.id !== alertId));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (!hasStore && !isDemoOrDevUser) {
    return (
      <div className="space-y-4">
        <Alert>
          <Store className="h-4 w-4" />
          <AlertTitle>No Store Connected</AlertTitle>
          <AlertDescription>
            Connect your Shopify store to start tracking inventory and sales.
          </AlertDescription>
        </Alert>
        <div className="flex justify-center">
          <Button asChild>
            <Link href="/settings">
              <Store className="mr-2 h-4 w-4" />
              Connect Shopify Store
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case "overview":
        return (
          <div className="space-y-6">
            {/* Analytics Overview */}
            {analyticsData && (
              <AnalyticsOverview
                data={analyticsData.summary}
                isLoading={analyticsLoading}
              />
            )}

            {/* Original Charts */}
            <div className="grid gap-6 md:grid-cols-2">
              <SalesChart data={salesData} />
              <InventoryChart data={inventoryData} />
            </div>

            {/* Compact Reorder Suggestions */}
            <ReorderSuggestions
              suggestions={suggestions.slice(0, 3)}
              onReorder={handleReorder}
              compact={true}
            />
          </div>
        );
      case "forecasts":
        return (
          <div className="space-y-6">
            <h2 className="text-xl font-semibold">Demand Forecasts</h2>
            <p className="text-muted-foreground">
              AI-powered predictions for your inventory needs over the next 30
              days.
            </p>
            {/* Forecast content will be implemented */}
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-8 text-center">
              <p className="text-muted-foreground">
                Forecast details coming soon...
              </p>
            </div>
          </div>
        );
      case "analytics":
        return (
          <div className="space-y-6">
            {analyticsData && (
              <>
                {/* Turnover Analysis */}
                <TurnoverChart
                  data={analyticsData.details.turnover}
                  period="30 days"
                />

                {/* Margin Analysis */}
                <MarginAnalysisChart
                  data={analyticsData.details.margins}
                  period="30 days"
                />

                {/* Stockout Tracking */}
                <StockoutTracker
                  data={analyticsData.details.stockouts}
                  period="30 days"
                  timeSeriesData={[
                    {
                      date: "Jan 1",
                      stockout_events: 2,
                      lost_revenue: 150,
                      affected_products: 2,
                    },
                    {
                      date: "Jan 2",
                      stockout_events: 1,
                      lost_revenue: 75,
                      affected_products: 1,
                    },
                    {
                      date: "Jan 3",
                      stockout_events: 3,
                      lost_revenue: 425,
                      affected_products: 2,
                    },
                    {
                      date: "Jan 4",
                      stockout_events: 0,
                      lost_revenue: 0,
                      affected_products: 0,
                    },
                    {
                      date: "Jan 5",
                      stockout_events: 1,
                      lost_revenue: 120,
                      affected_products: 1,
                    },
                  ]}
                />
              </>
            )}
          </div>
        );
      case "reorder":
        return (
          <div className="space-y-6">
            <ReorderSuggestions
              suggestions={suggestions}
              onReorder={handleReorder}
              showBulkActions={true}
            />
          </div>
        );
      case "reports":
        return (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold">Inventory Reports</h2>
              <Button>
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
            </div>
            <div className="grid gap-4">
              <div className="border rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Monthly Inventory Summary</h3>
                    <p className="text-sm text-muted-foreground">
                      Generated on {new Date().toLocaleDateString()}
                    </p>
                  </div>
                  <FileText className="h-5 w-5 text-muted-foreground" />
                </div>
              </div>
              <div className="border rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Reorder History</h3>
                    <p className="text-sm text-muted-foreground">
                      Last 30 days of reorder activities
                    </p>
                  </div>
                  <FileText className="h-5 w-5 text-muted-foreground" />
                </div>
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Alert Banner */}
      {alerts.length > 0 && (
        <AlertBanner alerts={alerts} onDismiss={handleAlertDismiss} />
      )}

      {/* Header with Sync Status */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">Inventory Dashboard</h1>
          {isDevUser && (
            <p className="text-sm text-muted-foreground">
              Development Mode - Using Mock Data
            </p>
          )}
          {isDemoUser && (
            <p className="text-sm text-muted-foreground">
              Demo Mode - Using Sample Data
            </p>
          )}
        </div>
        <SyncStatus
          lastSyncTime={lastSyncTime}
          isSyncing={syncing}
          syncProgress={syncProgress}
          onSync={handleSync}
        />
      </div>

      {/* Tabbed Navigation */}
      <DashboardTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab Content */}
      <div className="mt-6">{renderTabContent()}</div>
    </div>
  );
}
