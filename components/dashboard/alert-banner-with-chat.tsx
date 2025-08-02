"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { X, AlertCircle, Package, TrendingDown, Bell, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useChat } from "@/hooks/useChat";

export interface AlertItem {
  id: string;
  type: "reorder" | "stock" | "forecast" | "general";
  message: string;
  link?: string;
  linkText?: string;
  priority: "high" | "medium" | "low";
  data?: any; // Additional context data for AI
}

interface AlertBannerProps {
  alerts: AlertItem[];
  onDismiss: (alertId: string) => void;
  className?: string;
}

export function AlertBannerWithChat({ alerts, onDismiss, className }: AlertBannerProps) {
  const [visibleAlerts, setVisibleAlerts] = useState<AlertItem[]>([]);
  const { setIsOpen, sendMessage } = useChat();

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

  const getAIQuestion = (alert: AlertItem) => {
    switch (alert.type) {
      case "reorder":
        return "What should I do about these reorder alerts?";
      case "stock":
        return "How should I handle my stock situation?";
      case "forecast":
        return "Can you explain these forecast alerts?";
      default:
        return "What do these alerts mean for my business?";
    }
  };

  const openChatWithAlert = (alert: AlertItem) => {
    setIsOpen(true);
    setTimeout(() => {
      sendMessage(getAIQuestion(alert), {
        alertType: alert.type,
        alertPriority: alert.priority,
        alertMessage: alert.message,
        alertData: alert.data,
        allAlerts: alerts
      });
    }, 100);
  };

  return (
    <div className={cn("space-y-2", className)}>
      {/* Summary banner for multiple alerts */}
      {alerts.length > 1 && (
        <div className="flex items-center justify-between px-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            You have {alerts.length} active alerts ({alerts.filter(a => a.priority === "high").length} high priority)
          </p>
          <button
            onClick={() => openChatWithAlert({ 
              id: 'all', 
              type: 'general', 
              message: 'Multiple alerts', 
              priority: 'high' 
            })}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-900/20 hover:bg-blue-900/30 text-blue-300 rounded-md transition-colors border border-blue-500/30"
          >
            <MessageCircle className="w-3 h-3" />
            Ask AI about all alerts
          </button>
        </div>
      )}

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
            <div className="flex items-center gap-3 flex-1">
              <Icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
              <p className="text-sm font-medium flex-1">
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
            <div className="flex items-center gap-2 ml-4">
              <button
                onClick={() => openChatWithAlert(alert)}
                className={cn(
                  "p-1 rounded-md transition-colors",
                  "hover:bg-black/10 dark:hover:bg-white/10",
                  "flex items-center gap-1 text-xs"
                )}
                aria-label="Ask AI about this alert"
                title="Ask AI about this alert"
              >
                <MessageCircle className="h-4 w-4" />
                <span className="hidden sm:inline">Ask AI</span>
              </button>
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
          </div>
        );
      })}
    </div>
  );
}