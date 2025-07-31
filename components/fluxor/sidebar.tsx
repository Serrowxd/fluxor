"use client";

import {
  BarChart2,
  Receipt,
  Building2,
  CreditCard,
  Folder,
  Wallet,
  Users2,
  Shield,
  MessagesSquare,
  Video,
  Settings,
  HelpCircle,
  Menu,
  Home,
  Package,
  TrendingUp,
  FileText,
  Bell,
  Store,
  LogOut,
  ChevronLeft,
  RefreshCw,
  Eye,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import Image from "next/image";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRouter } from "next/navigation";

export default function Sidebar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { logout } = useAuth();
  const router = useRouter();

  function handleNavigation() {
    setIsMobileMenuOpen(false);
  }

  function NavItem({
    href,
    icon: Icon,
    children,
    badge,
  }: {
    href: string;
    icon: any;
    children: React.ReactNode;
    badge?: number;
  }) {
    const content = (
      <Link
        href={href}
        onClick={handleNavigation}
        className={cn(
          "flex items-center px-3 py-2 text-sm rounded-md transition-colors text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-[#1F1F23]",
          isCollapsed && "justify-center"
        )}
      >
        <Icon className={cn("h-4 w-4", !isCollapsed && "mr-3")} />
        {!isCollapsed && (
          <>
            <span className="flex-1">{children}</span>
            {badge !== undefined && badge > 0 && (
              <span className="ml-auto bg-red-500 text-white text-xs font-medium px-2 py-0.5 rounded-full">
                {badge}
              </span>
            )}
          </>
        )}
      </Link>
    );

    if (isCollapsed) {
      return (
        <TooltipProvider>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>{content}</TooltipTrigger>
            <TooltipContent side="right" className="flex items-center gap-2">
              {children}
              {badge !== undefined && badge > 0 && (
                <span className="bg-red-500 text-white text-xs font-medium px-2 py-0.5 rounded-full">
                  {badge}
                </span>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return content;
  }

  function QuickAction({
    icon: Icon,
    onClick,
    label,
    active = false,
  }: {
    icon: any;
    onClick: () => void;
    label: string;
    active?: boolean;
  }) {
    const button = (
      <button
        onClick={onClick}
        className={cn(
          "p-2 rounded-md transition-colors",
          "hover:bg-gray-100 dark:hover:bg-gray-800",
          active && "bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400"
        )}
        aria-label={label}
      >
        <Icon className="h-4 w-4" />
      </button>
    );

    if (isCollapsed) {
      return (
        <TooltipProvider>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return button;
  }

  const handleSyncData = () => {
    // Trigger sync from dashboard
    const syncButton = document.querySelector('[aria-label="Sync data"]') as HTMLButtonElement;
    if (syncButton) {
      syncButton.click();
    }
  };

  const handleViewAlerts = () => {
    router.push('/alerts');
  };

  const handleSettings = () => {
    router.push('/settings');
  };

  return (
    <>
      <button
        type="button"
        className="lg:hidden fixed top-4 left-4 z-[70] p-2 rounded-lg bg-white dark:bg-[#0F0F12] shadow-md"
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
      >
        <Menu className="h-5 w-5 text-gray-600 dark:text-gray-300" />
      </button>
      <nav
        className={cn(
          "fixed inset-y-0 left-0 z-[70] bg-white dark:bg-[#0F0F12] transform transition-all duration-200 ease-in-out",
          "lg:translate-x-0 lg:static border-r border-gray-200 dark:border-[#1F1F23]",
          isMobileMenuOpen ? "translate-x-0" : "-translate-x-full",
          isCollapsed ? "w-16" : "w-64"
        )}
      >
        <div className="h-full flex flex-col">
          <div className={cn(
            "h-16 px-6 flex items-center border-b border-gray-200 dark:border-[#1F1F23]",
            isCollapsed && "px-4 justify-center"
          )}>
            <Link
              href="/"
              className="flex items-center gap-3"
            >
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">F</span>
              </div>
              {!isCollapsed && (
                <span className="text-lg font-semibold hover:cursor-pointer text-gray-900 dark:text-white">
                  Fluxor
                </span>
              )}
            </Link>
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className={cn(
                "ml-auto p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors lg:block hidden",
                isCollapsed && "ml-0"
              )}
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <ChevronLeft className={cn(
                "h-4 w-4 text-gray-600 dark:text-gray-400 transition-transform",
                isCollapsed && "rotate-180"
              )} />
            </button>
          </div>

          {/* Quick Actions */}
          <div className={cn(
            "px-4 py-3 border-b border-gray-200 dark:border-[#1F1F23]",
            isCollapsed && "px-2"
          )}>
            {!isCollapsed && (
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                Quick Actions
              </div>
            )}
            <div className={cn(
              "flex gap-2",
              isCollapsed && "flex-col items-center"
            )}>
              <QuickAction
                icon={RefreshCw}
                onClick={handleSyncData}
                label="Sync Data"
              />
              <QuickAction
                icon={Bell}
                onClick={handleViewAlerts}
                label="View Alerts"
                active={true}
              />
              <QuickAction
                icon={Settings}
                onClick={handleSettings}
                label="Settings"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-4 px-4">
            <div className="space-y-6">
              <div>
                {!isCollapsed && (
                  <div className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Overview
                  </div>
                )}
                <div className="space-y-1">
                  <NavItem href="/dashboard" icon={Home}>
                    Dashboard
                  </NavItem>
                  <NavItem href="/inventory" icon={Package}>
                    Inventory
                  </NavItem>
                  <NavItem href="/forecasts" icon={TrendingUp}>
                    Forecasts
                  </NavItem>
                  <NavItem href="/reports" icon={FileText}>
                    Reports
                  </NavItem>
                </div>
              </div>

              <div>
                {!isCollapsed && (
                  <div className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Integration
                  </div>
                )}
                <div className="space-y-1">
                  <NavItem href="/shopify" icon={Store}>
                    Shopify
                  </NavItem>
                  <NavItem href="/alerts" icon={Bell} badge={4}>
                    Alerts
                  </NavItem>
                </div>
              </div>

              <div>
                {!isCollapsed && (
                  <div className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Account
                  </div>
                )}
                <div className="space-y-1">
                  <NavItem href="/settings" icon={Settings}>
                    Settings
                  </NavItem>
                  <NavItem href="/help" icon={HelpCircle}>
                    Help
                  </NavItem>
                </div>
              </div>
            </div>
          </div>

          <div className="px-4 py-4 border-t border-gray-200 dark:border-[#1F1F23]">
            <div className="space-y-1">
              <Button
                variant="ghost"
                className={cn(
                  "w-full justify-start px-3 py-2 text-sm font-normal",
                  isCollapsed && "justify-center px-2"
                )}
                onClick={() => {
                  handleNavigation();
                  logout();
                }}
              >
                <LogOut className={cn("h-4 w-4", !isCollapsed && "mr-3")} />
                {!isCollapsed && "Logout"}
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-[65] lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
    </>
  );
}
