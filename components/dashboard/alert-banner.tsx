"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { X, AlertCircle, Package, TrendingDown, Bell } from "lucide-react";
import Link from "next/link";

export interface AlertItem {
  id: string;
  type: "reorder" | "stock" | "forecast" | "general";
  message: string;
  link?: string;
  linkText?: string;
  priority: "high" | "medium" | "low";
}

interface AlertBannerProps {
  alerts: AlertItem[];
  onDismiss: (alertId: string) => void;
  className?: string;
}

export function AlertBanner({ alerts, onDismiss, className }: AlertBannerProps) {
  const [visibleAlerts, setVisibleAlerts] = useState<AlertItem[]>([]);

  useEffect(() => {
    // Only show high priority alerts by default, or the most recent alert
    const highPriorityAlerts = alerts.filter(a => a.priority === "high");
    setVisibleAlerts(highPriorityAlerts.length > 0 ? highPriorityAlerts : alerts.slice(0, 1));
  }, [alerts]);

  if (visibleAlerts.length === 0) return null;

  const getAlertIcon = (type: AlertItem["type"]) => {
    switch (type) {
      case "reorder":
        return Package;
      case "stock":
        return TrendingDown;
      case "forecast":
        return AlertCircle;
      default:
        return Bell;
    }
  };

  const getAlertColor = (priority: AlertItem["priority"]) => {
    switch (priority) {
      case "high":
        return "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200";
      case "medium":
        return "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200";
      case "low":
        return "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200";
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      {visibleAlerts.map((alert) => {
        const Icon = getAlertIcon(alert.type);
        const colorClasses = getAlertColor(alert.priority);

        return (
          <div
            key={alert.id}
            className={cn(
              "flex items-center justify-between px-4 py-3 rounded-lg border",
              colorClasses,
              "animate-in slide-in-from-top-2 duration-300"
            )}
            role="alert"
            aria-live="polite"
          >
            <div className="flex items-center gap-3">
              <Icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
              <p className="text-sm font-medium">
                {alert.message}
                {alert.link && alert.linkText && (
                  <>
                    {" "}
                    <Link
                      href={alert.link}
                      className="underline hover:no-underline font-semibold"
                    >
                      {alert.linkText}
                    </Link>
                  </>
                )}
              </p>
            </div>
            <button
              onClick={() => onDismiss(alert.id)}
              className={cn(
                "p-1 rounded-md transition-colors",
                "hover:bg-black/10 dark:hover:bg-white/10"
              )}
              aria-label="Dismiss alert"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}