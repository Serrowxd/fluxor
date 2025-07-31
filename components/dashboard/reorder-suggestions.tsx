"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { 
  Package, 
  ShoppingCart, 
  ChevronDown, 
  ChevronUp,
  Calendar,
  Truck,
  TrendingUp,
  AlertCircle
} from "lucide-react";

interface ReorderSuggestion {
  productId: string;
  productName: string;
  sku: string;
  currentStock: number;
  predictedDemand: number;
  suggestedReorderAmount: number;
  urgency: "high" | "medium" | "low";
  lastReorderDate?: Date;
  supplierLeadTime?: number;
}

interface ReorderSuggestionsProps {
  suggestions: ReorderSuggestion[];
  onReorder: (productId: string) => void;
  compact?: boolean;
  showBulkActions?: boolean;
}

export function ReorderSuggestions({ 
  suggestions, 
  onReorder, 
  compact = false,
  showBulkActions = false 
}: ReorderSuggestionsProps) {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleSelection = (productId: string) => {
    const newSelection = new Set(selectedItems);
    if (newSelection.has(productId)) {
      newSelection.delete(productId);
    } else {
      newSelection.add(productId);
    }
    setSelectedItems(newSelection);
  };

  const toggleAllSelection = () => {
    if (selectedItems.size === suggestions.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(suggestions.map(s => s.productId)));
    }
  };

  const toggleRowExpansion = (productId: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(productId)) {
      newExpanded.delete(productId);
    } else {
      newExpanded.add(productId);
    }
    setExpandedRows(newExpanded);
  };

  const handleBulkReorder = () => {
    selectedItems.forEach(productId => {
      onReorder(productId);
    });
    setSelectedItems(new Set());
  };

  const getUrgencyBadge = (urgency: string) => {
    switch (urgency) {
      case "high":
        return (
          <Badge variant="destructive" className="flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            High
          </Badge>
        );
      case "medium":
        return <Badge variant="secondary">Medium</Badge>;
      case "low":
        return <Badge variant="outline">Low</Badge>;
      default:
        return null;
    }
  };

  const getStockPercentage = (current: number, predicted: number) => {
    return Math.round((current / predicted) * 100);
  };

  const formatDate = (date?: Date) => {
    if (!date) return "N/A";
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Package className="h-5 w-5" />
          Reorder Suggestions
        </h2>
        {showBulkActions && selectedItems.size > 0 && (
          <Button onClick={handleBulkReorder} size="sm">
            <ShoppingCart className="mr-2 h-4 w-4" />
            Reorder Selected ({selectedItems.size})
          </Button>
        )}
      </div>

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {showBulkActions && (
                <TableHead className="w-12">
                  <Checkbox
                    checked={selectedItems.size === suggestions.length}
                    onCheckedChange={toggleAllSelection}
                    aria-label="Select all"
                  />
                </TableHead>
              )}
              <TableHead>Product</TableHead>
              <TableHead className="text-center">Stock Level</TableHead>
              <TableHead className="text-center">Urgency</TableHead>
              {!compact && (
                <>
                  <TableHead className="text-center">Last Reorder</TableHead>
                  <TableHead className="text-center">Lead Time</TableHead>
                </>
              )}
              <TableHead className="text-center">Suggested Amount</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {suggestions.map((suggestion) => {
              const stockPercentage = getStockPercentage(
                suggestion.currentStock,
                suggestion.predictedDemand
              );
              const isExpanded = expandedRows.has(suggestion.productId);
              const isSelected = selectedItems.has(suggestion.productId);

              return (
                <>
                  <TableRow 
                    key={suggestion.productId}
                    className={cn(
                      "transition-colors",
                      isSelected && "bg-muted/50"
                    )}
                  >
                    {showBulkActions && (
                      <TableCell>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelection(suggestion.productId)}
                          aria-label={`Select ${suggestion.productName}`}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">{suggestion.productName}</div>
                          <div className="text-sm text-muted-foreground">
                            SKU: {suggestion.sku}
                          </div>
                        </div>
                        {!compact && (
                          <button
                            onClick={() => toggleRowExpansion(suggestion.productId)}
                            className="p-1 hover:bg-muted rounded"
                            aria-label={isExpanded ? "Collapse details" : "Expand details"}
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span>{suggestion.currentStock}</span>
                          <span className="text-muted-foreground">
                            / {suggestion.predictedDemand}
                          </span>
                        </div>
                        <Progress 
                          value={stockPercentage} 
                          className={cn(
                            "h-2",
                            stockPercentage < 30 && "bg-red-100 dark:bg-red-900",
                            stockPercentage >= 30 && stockPercentage < 60 && "bg-amber-100 dark:bg-amber-900",
                            stockPercentage >= 60 && "bg-green-100 dark:bg-green-900"
                          )}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {getUrgencyBadge(suggestion.urgency)}
                    </TableCell>
                    {!compact && (
                      <>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1 text-sm">
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                            {formatDate(suggestion.lastReorderDate)}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1 text-sm">
                            <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                            {suggestion.supplierLeadTime || "N/A"} days
                          </div>
                        </TableCell>
                      </>
                    )}
                    <TableCell className="text-center">
                      <div className="font-medium text-lg">
                        {suggestion.suggestedReorderAmount}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => onReorder(suggestion.productId)}
                        disabled={isSelected && showBulkActions}
                      >
                        Reorder
                      </Button>
                    </TableCell>
                  </TableRow>
                  {!compact && isExpanded && (
                    <TableRow>
                      <TableCell 
                        colSpan={showBulkActions ? 8 : 7} 
                        className="bg-muted/30 p-4"
                      >
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <h4 className="font-medium text-sm mb-2 flex items-center gap-1">
                              <TrendingUp className="h-4 w-4" />
                              Sales Trend
                            </h4>
                            <p className="text-sm text-muted-foreground">
                              Average daily sales: {Math.round(suggestion.predictedDemand / 30)} units
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Days until stockout: {Math.round(suggestion.currentStock / (suggestion.predictedDemand / 30))}
                            </p>
                          </div>
                          <div>
                            <h4 className="font-medium text-sm mb-2">Forecast Confidence</h4>
                            <Progress value={85} className="h-2 mb-1" />
                            <p className="text-xs text-muted-foreground">85% confidence level</p>
                          </div>
                          <div>
                            <h4 className="font-medium text-sm mb-2">Reorder Notes</h4>
                            <p className="text-sm text-muted-foreground">
                              Based on {suggestion.supplierLeadTime || 7} day lead time and 
                              seasonal demand patterns.
                            </p>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {suggestions.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No reorder suggestions at this time.</p>
          <p className="text-sm mt-2">
            All inventory levels are within optimal range.
          </p>
        </div>
      )}
    </div>
  );
}