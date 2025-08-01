"use client";

import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Zap,
  Settings,
  Activity,
} from "lucide-react";

interface Channel {
  channel_id: string;
  channel_name: string;
  channel_type: string;
  credentials_valid: boolean;
  product_count: number;
  last_synced?: string;
}

interface SyncStatus {
  sync_id: string;
  channel_id: string;
  channel_type: string;
  channel_name: string;
  status: "pending" | "running" | "completed" | "failed" | "paused";
  started_at: string;
  completed_at?: string;
  total_records: number;
  processed_records: number;
  successful_records: number;
  failed_records: number;
  error_message?: string;
}

interface Conflict {
  conflict_id: string;
  product_id: string;
  product_name: string;
  sku: string;
  conflict_type: string;
  priority: "low" | "medium" | "high" | "critical";
  status: "pending" | "resolving" | "resolved" | "ignored";
  created_at: string;
}

export function MultiChannelSync() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  // Fetch data on component mount and set up polling
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      const [channelsRes, statusRes, conflictsRes] = await Promise.all([
        fetch("/api/multi-channel/channels"),
        fetch("/api/multi-channel/sync/status"),
        fetch("/api/multi-channel/conflicts"),
      ]);

      if (channelsRes.ok) {
        const channelsData = await channelsRes.json();
        setChannels(channelsData.channels || []);
      }

      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setSyncStatus(statusData.syncStatus || []);
      }

      if (conflictsRes.ok) {
        const conflictsData = await conflictsRes.json();
        setConflicts(conflictsData.conflicts || []);
      }

      setLastRefresh(new Date());
    } catch (error) {
      console.error("Failed to fetch multi-channel data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSyncAll = async () => {
    try {
      setIsSyncing(true);
      const response = await fetch("/api/multi-channel/sync/all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ options: {} }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log("Sync started:", result);
        // Refresh data after a short delay
        setTimeout(fetchData, 2000);
      }
    } catch (error) {
      console.error("Failed to start sync:", error);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSyncChannel = async (channelId: string) => {
    try {
      const response = await fetch(
        `/api/multi-channel/sync/channel/${channelId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ options: {} }),
        }
      );

      if (response.ok) {
        const result = await response.json();
        console.log("Channel sync started:", result);
        setTimeout(fetchData, 2000);
      }
    } catch (error) {
      console.error("Failed to start channel sync:", error);
    }
  };

  const handleResolveConflict = async (
    conflictId: string,
    strategy: string
  ) => {
    try {
      const response = await fetch(
        `/api/multi-channel/conflicts/${conflictId}/resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ strategy }),
        }
      );

      if (response.ok) {
        const result = await response.json();
        console.log("Conflict resolution started:", result);
        setTimeout(fetchData, 2000);
      }
    } catch (error) {
      console.error("Failed to resolve conflict:", error);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "running":
        return <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />;
      case "pending":
        return <Clock className="h-4 w-4 text-yellow-500" />;
      default:
        return <AlertTriangle className="h-4 w-4 text-gray-500" />;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "critical":
        return "destructive";
      case "high":
        return "destructive";
      case "medium":
        return "default";
      case "low":
        return "secondary";
      default:
        return "default";
    }
  };

  const formatDuration = (start: string, end?: string) => {
    const startTime = new Date(start);
    const endTime = end ? new Date(end) : new Date();
    const duration = Math.round(
      (endTime.getTime() - startTime.getTime()) / 1000
    );

    if (duration < 60) return `${duration}s`;
    if (duration < 3600)
      return `${Math.floor(duration / 60)}m ${duration % 60}s`;
    return `${Math.floor(duration / 3600)}h ${Math.floor(
      (duration % 3600) / 60
    )}m`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Multi-Channel Sync
          </h2>
          <p className="text-muted-foreground">
            Manage inventory synchronization across all your sales channels
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchData}
            disabled={isLoading}
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          <Button onClick={handleSyncAll} disabled={isSyncing || isLoading}>
            <Zap className="h-4 w-4 mr-2" />
            {isSyncing ? "Syncing..." : "Sync All"}
          </Button>
        </div>
      </div>

      {/* Last Refresh Info */}
      <div className="text-sm text-muted-foreground">
        Last updated: {lastRefresh.toLocaleTimeString()}
      </div>

      <Tabs defaultValue="channels" className="space-y-4">
        <TabsList>
          <TabsTrigger value="channels">Channels</TabsTrigger>
          <TabsTrigger value="sync-status">Sync Status</TabsTrigger>
          <TabsTrigger value="conflicts">
            Conflicts
            {conflicts.length > 0 && (
              <Badge variant="destructive" className="ml-2">
                {conflicts.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="channels" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {channels.map((channel) => (
              <Card key={channel.channel_id}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {channel.channel_name}
                  </CardTitle>
                  <Badge
                    variant={
                      channel.credentials_valid ? "default" : "destructive"
                    }
                  >
                    {channel.channel_type.toUpperCase()}
                  </Badge>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Status:</span>
                      <Badge
                        variant={
                          channel.credentials_valid ? "default" : "destructive"
                        }
                      >
                        {channel.credentials_valid ? "Connected" : "Error"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span>Products:</span>
                      <span>{channel.product_count}</span>
                    </div>
                    {channel.last_synced && (
                      <div className="flex items-center justify-between text-sm">
                        <span>Last Sync:</span>
                        <span>
                          {new Date(channel.last_synced).toLocaleTimeString()}
                        </span>
                      </div>
                    )}
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => handleSyncChannel(channel.channel_id)}
                      disabled={!channel.credentials_valid || isSyncing}
                    >
                      <RefreshCw className="h-3 w-3 mr-2" />
                      Sync Now
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="sync-status" className="space-y-4">
          <div className="space-y-4">
            {syncStatus.length === 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center text-muted-foreground">
                    No recent sync operations
                  </div>
                </CardContent>
              </Card>
            ) : (
              syncStatus.map((sync) => (
                <Card key={sync.sync_id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">
                        {sync.channel_name} Sync
                      </CardTitle>
                      <div className="flex items-center space-x-2">
                        {getStatusIcon(sync.status)}
                        <Badge
                          variant={
                            sync.status === "completed"
                              ? "default"
                              : sync.status === "failed"
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          {sync.status}
                        </Badge>
                      </div>
                    </div>
                    <CardDescription>
                      Started{" "}
                      {formatDuration(sync.started_at, sync.completed_at)} ago
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {sync.status === "running" && (
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span>Progress</span>
                            <span>
                              {sync.processed_records}/{sync.total_records}
                            </span>
                          </div>
                          <Progress
                            value={
                              (sync.processed_records / sync.total_records) *
                              100
                            }
                            className="h-2"
                          />
                        </div>
                      )}

                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <div className="text-muted-foreground">
                            Successful
                          </div>
                          <div className="font-medium text-green-600">
                            {sync.successful_records}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Failed</div>
                          <div className="font-medium text-red-600">
                            {sync.failed_records}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Total</div>
                          <div className="font-medium">
                            {sync.total_records}
                          </div>
                        </div>
                      </div>

                      {sync.error_message && (
                        <Alert>
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription>
                            {sync.error_message}
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="conflicts" className="space-y-4">
          <div className="space-y-4">
            {conflicts.length === 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center text-muted-foreground">
                    <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                    No conflicts detected
                  </div>
                </CardContent>
              </Card>
            ) : (
              conflicts.map((conflict) => (
                <Card key={conflict.conflict_id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">
                        {conflict.product_name} ({conflict.sku})
                      </CardTitle>
                      <div className="flex items-center space-x-2">
                        <Badge variant={getPriorityColor(conflict.priority)}>
                          {conflict.priority}
                        </Badge>
                        <Badge variant="outline">
                          {conflict.conflict_type.replace("_", " ")}
                        </Badge>
                      </div>
                    </div>
                    <CardDescription>
                      Detected {formatDuration(conflict.created_at)} ago
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="text-sm text-muted-foreground">
                        Status:{" "}
                        <Badge variant="outline">{conflict.status}</Badge>
                      </div>

                      {conflict.status === "pending" && (
                        <div className="flex space-x-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              handleResolveConflict(
                                conflict.conflict_id,
                                "conservative_approach"
                              )
                            }
                          >
                            Auto-Resolve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              handleResolveConflict(
                                conflict.conflict_id,
                                "manual_review"
                              )
                            }
                          >
                            Manual Review
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
