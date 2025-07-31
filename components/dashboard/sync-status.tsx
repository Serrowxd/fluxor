"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { RefreshCw, Check, AlertCircle } from "lucide-react";

interface SyncStatusProps {
  lastSyncTime?: Date;
  isSyncing: boolean;
  syncProgress?: number;
  syncError?: string;
  onSync: () => void;
  className?: string;
}

export function SyncStatus({ 
  lastSyncTime, 
  isSyncing, 
  syncProgress, 
  syncError,
  onSync,
  className 
}: SyncStatusProps) {
  const [timeAgo, setTimeAgo] = useState<string>("");

  useEffect(() => {
    const updateTimeAgo = () => {
      if (!lastSyncTime) {
        setTimeAgo("Never synced");
        return;
      }

      const now = new Date();
      const diff = now.getTime() - lastSyncTime.getTime();
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (minutes < 1) {
        setTimeAgo("Just now");
      } else if (minutes < 60) {
        setTimeAgo(`${minutes} minute${minutes > 1 ? 's' : ''} ago`);
      } else if (hours < 24) {
        setTimeAgo(`${hours} hour${hours > 1 ? 's' : ''} ago`);
      } else {
        setTimeAgo(`${days} day${days > 1 ? 's' : ''} ago`);
      }
    };

    updateTimeAgo();
    const interval = setInterval(updateTimeAgo, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [lastSyncTime]);

  const getSyncStatusIcon = () => {
    if (syncError) return AlertCircle;
    if (isSyncing) return RefreshCw;
    return Check;
  };

  const getSyncStatusColor = () => {
    if (syncError) return "text-red-600 dark:text-red-400";
    if (isSyncing) return "text-blue-600 dark:text-blue-400";
    return "text-green-600 dark:text-green-400";
  };

  const Icon = getSyncStatusIcon();
  const colorClass = getSyncStatusColor();

  return (
    <div className={cn("flex items-center gap-4", className)}>
      {/* Sync Status Text */}
      <div className="flex items-center gap-2 text-sm">
        <Icon 
          className={cn(
            "h-4 w-4",
            colorClass,
            isSyncing && "animate-spin"
          )} 
        />
        <span className="text-gray-600 dark:text-gray-400">
          {isSyncing ? (
            <>
              Syncing...
              {syncProgress !== undefined && (
                <span className="ml-1">({Math.round(syncProgress)}%)</span>
              )}
            </>
          ) : syncError ? (
            <span className="text-red-600 dark:text-red-400">Sync failed</span>
          ) : (
            <>Last synced: <span className="font-medium">{timeAgo}</span></>
          )}
        </span>
      </div>

      {/* Sync Button */}
      <button
        onClick={onSync}
        disabled={isSyncing}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
          "bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700",
          "text-gray-700 dark:text-gray-300",
          "disabled:opacity-50 disabled:cursor-not-allowed"
        )}
        aria-label="Sync data"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", isSyncing && "animate-spin")} />
        {isSyncing ? "Syncing..." : "Sync Now"}
      </button>

      {/* Progress Bar (if syncing) */}
      {isSyncing && syncProgress !== undefined && (
        <div className="hidden sm:block w-32">
          <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-500 dark:bg-blue-400 transition-all duration-300"
              style={{ width: `${syncProgress}%` }}
              role="progressbar"
              aria-valuenow={syncProgress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>
      )}
    </div>
  );
}