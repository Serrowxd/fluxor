"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { ProtectedRoute } from "@/lib/protected-route";
import Layout from "@/components/fluxor/layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Store, Save, Loader2 } from "lucide-react";

const timezones = [
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "Eastern Time" },
  { value: "America/Chicago", label: "Central Time" },
  { value: "America/Denver", label: "Mountain Time" },
  { value: "America/Los_Angeles", label: "Pacific Time" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Paris", label: "Paris" },
  { value: "Asia/Tokyo", label: "Tokyo" },
  { value: "Australia/Sydney", label: "Sydney" },
];

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasStore, setHasStore] = useState(false);
  const [settings, setSettings] = useState({
    low_stock_threshold: 10,
    alert_email_enabled: true,
    time_zone: "UTC",
  });

  // Check if this is a dev or demo user
  const isDevUser = user?.user_id === "dev-user-123";
  const isDemoUser = user?.user_id === "demo-user-456";
  const isDemoOrDevUser = isDevUser || isDemoUser;

  useEffect(() => {
    if (user?.settings) {
      setSettings(user.settings);
    }

    if (isDemoOrDevUser) {
      // Set dummy store connection for demo or dev user
      setHasStore(true);
    } else {
      checkShopifyConnection();
    }
  }, [user, isDemoOrDevUser]);

  const checkShopifyConnection = async () => {
    try {
      const response = await fetch("http://localhost:3001/api/shopify/stores", {
        credentials: "include",
      });
      const data = await response.json();
      setHasStore(data.stores && data.stores.length > 0);
    } catch (error) {
      console.error("Failed to check Shopify connection:", error);
    }
  };

  const handleSaveSettings = async () => {
    setSaving(true);

    if (isDemoOrDevUser) {
      // Simulate saving for demo or dev user
      setTimeout(() => {
        // Update the user in localStorage
        const storageKey = isDevUser ? "dev_user" : "demo_user";
        const storedUser = JSON.parse(localStorage.getItem(storageKey) || "{}");
        storedUser.settings = settings;
        localStorage.setItem(storageKey, JSON.stringify(storedUser));

        toast({
          title: "Settings saved",
          description: isDevUser
            ? "Your development settings have been updated."
            : "Your demo settings have been updated.",
        });
        setSaving(false);
      }, 1000);
    } else {
      try {
        const response = await fetch("http://localhost:3001/api/settings", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify(settings),
        });

        if (response.ok) {
          toast({
            title: "Settings saved",
            description: "Your settings have been updated successfully.",
          });
          await refreshUser();
        } else {
          throw new Error("Failed to save settings");
        }
      } catch (error) {
        toast({
          title: "Error",
          description: "Failed to save settings. Please try again.",
          variant: "destructive",
        });
      } finally {
        setSaving(false);
      }
    }
  };

  const handleConnectShopify = () => {
    if (isDemoOrDevUser) {
      toast({
        title: isDevUser ? "Development Mode" : "Demo Mode",
        description: isDevUser
          ? "Shopify connection is simulated in development mode."
          : "Shopify connection is simulated in demo mode.",
      });
    } else {
      window.location.href = "http://localhost:3001/api/shopify/authorize";
    }
  };

  return (
    <ProtectedRoute>
      <Layout>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="text-muted-foreground">
              Manage your account settings and preferences
            </p>
            {isDevUser && (
              <p className="text-sm text-muted-foreground mt-1">
                Development Mode - Changes are saved locally
              </p>
            )}
            {isDemoUser && (
              <p className="text-sm text-muted-foreground mt-1">
                Demo Mode - Changes are saved locally
              </p>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Shopify Integration</CardTitle>
              <CardDescription>
                Connect your Shopify store to sync inventory and sales data
              </CardDescription>
            </CardHeader>
            <CardContent>
              {hasStore ? (
                <div className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <div className="h-2 w-2 bg-green-500 rounded-full" />
                    <span className="text-sm">
                      {isDevUser
                        ? "Connected to Demo Store"
                        : "Connected to Shopify"}
                    </span>
                  </div>
                  {isDevUser && (
                    <div className="text-sm text-muted-foreground">
                      <p>Store: Demo Fashion Store</p>
                      <p>Domain: demo-store.myshopify.com</p>
                      <p>Products: 8 items</p>
                    </div>
                  )}
                  <Button variant="outline" onClick={handleConnectShopify}>
                    <Store className="mr-2 h-4 w-4" />
                    Reconnect Store
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    No store connected. Connect your Shopify store to start
                    tracking inventory.
                  </p>
                  <Button onClick={handleConnectShopify}>
                    <Store className="mr-2 h-4 w-4" />
                    Connect Shopify Store
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Alert Settings</CardTitle>
              <CardDescription>
                Configure how you receive inventory alerts
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="threshold">Low Stock Threshold</Label>
                <Input
                  id="threshold"
                  type="number"
                  min="1"
                  value={settings.low_stock_threshold}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      low_stock_threshold: parseInt(e.target.value) || 10,
                    })
                  }
                />
                <p className="text-sm text-muted-foreground">
                  Alert when stock falls below this number
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="email-alerts"
                  checked={settings.alert_email_enabled}
                  onCheckedChange={(checked) =>
                    setSettings({ ...settings, alert_email_enabled: checked })
                  }
                />
                <Label htmlFor="email-alerts">Enable email alerts</Label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Regional Settings</CardTitle>
              <CardDescription>
                Configure your timezone for accurate reporting
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="timezone">Time Zone</Label>
                <Select
                  value={settings.time_zone}
                  onValueChange={(value) =>
                    setSettings({ ...settings, time_zone: value })
                  }
                >
                  <SelectTrigger id="timezone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {timezones.map((tz) => (
                      <SelectItem key={tz.value} value={tz.value}>
                        {tz.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleSaveSettings} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Settings
                </>
              )}
            </Button>
          </div>
        </div>
      </Layout>
    </ProtectedRoute>
  );
}
