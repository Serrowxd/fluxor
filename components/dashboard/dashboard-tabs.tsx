"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { 
  LayoutDashboard, 
  TrendingUp, 
  Package, 
  FileText,
  ChevronDown
} from "lucide-react";

interface Tab {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const tabs: Tab[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "forecasts", label: "Forecasts", icon: TrendingUp },
  { id: "reorder", label: "Reorder", icon: Package },
  { id: "reports", label: "Reports", icon: FileText },
];

interface DashboardTabsProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

export function DashboardTabs({ activeTab, onTabChange, className }: DashboardTabsProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const activeTabData = tabs.find(tab => tab.id === activeTab);

  return (
    <div className={cn("border-b border-gray-200 dark:border-gray-800", className)}>
      {/* Desktop Tabs */}
      <nav className="hidden md:flex space-x-1 px-6" aria-label="Dashboard tabs">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
                "hover:text-gray-900 dark:hover:text-gray-100",
                isActive
                  ? "border-blue-500 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-gray-600 dark:text-gray-400"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Mobile Dropdown */}
      <div className="md:hidden px-4 py-3">
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="flex items-center justify-between w-full px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-lg"
          aria-expanded={isMobileMenuOpen}
          aria-haspopup="true"
        >
          <span className="flex items-center gap-2">
            {activeTabData && (
              <>
                <activeTabData.icon className="h-4 w-4" />
                {activeTabData.label}
              </>
            )}
          </span>
          <ChevronDown className={cn(
            "h-4 w-4 transition-transform",
            isMobileMenuOpen && "rotate-180"
          )} />
        </button>

        {isMobileMenuOpen && (
          <div className="mt-2 py-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    onTabChange(tab.id);
                    setIsMobileMenuOpen(false);
                  }}
                  className={cn(
                    "flex items-center gap-2 w-full px-4 py-2 text-sm font-medium transition-colors",
                    "hover:bg-gray-50 dark:hover:bg-gray-700",
                    isActive
                      ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20"
                      : "text-gray-700 dark:text-gray-300"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}