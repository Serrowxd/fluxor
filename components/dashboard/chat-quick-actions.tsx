"use client";

import { cn } from "@/lib/utils";
import { MessageCircle, TrendingUp, Package, ShoppingCart, Calendar } from "lucide-react";
import { useChat } from "@/hooks/useChat";

interface QuickAction {
  icon: React.ElementType;
  label: string;
  question: string;
  context?: any;
  category: "analytics" | "inventory" | "purchasing" | "planning";
}

interface ChatQuickActionsProps {
  suggestions?: ReorderSuggestion[];
  salesData?: any[];
  inventoryData?: any[];
  className?: string;
}

interface ReorderSuggestion {
  productId: string;
  productName: string;
  urgency: "high" | "medium" | "low";
}

export function ChatQuickActions({ 
  suggestions = [], 
  salesData = [], 
  inventoryData = [], 
  className 
}: ChatQuickActionsProps) {
  const { setIsOpen, sendMessage } = useChat();

  const openChatWithContext = (question: string, context?: any) => {
    setIsOpen(true);
    setTimeout(() => {
      sendMessage(question, context);
    }, 100);
  };

  // Dynamic quick actions based on current dashboard state
  const getQuickActions = (): QuickAction[] => {
    const actions: QuickAction[] = [];

    // High priority items action
    const highPriorityCount = suggestions.filter(s => s.urgency === "high").length;
    if (highPriorityCount > 0) {
      actions.push({
        icon: ShoppingCart,
        label: `${highPriorityCount} Urgent Reorders`,
        question: "Which high-priority items should I reorder first?",
        context: { 
          highPriorityItems: suggestions.filter(s => s.urgency === "high"),
          totalHighPriority: highPriorityCount 
        },
        category: "purchasing"
      });
    }

    // Sales trend action
    if (salesData.length > 0) {
      const avgSales = Math.round(
        salesData.reduce((sum, item) => sum + item.sales, 0) / salesData.length
      );
      actions.push({
        icon: TrendingUp,
        label: "Sales Analysis",
        question: "What are my sales trends telling me?",
        context: { 
          salesData: salesData,
          avgSales: avgSales,
          period: "last 7 days"
        },
        category: "analytics"
      });
    }

    // Low stock action
    const lowStockCount = inventoryData.filter(
      item => item.currentStock < item.lowStockThreshold
    ).length;
    if (lowStockCount > 0) {
      actions.push({
        icon: Package,
        label: `${lowStockCount} Low Stock`,
        question: "Which products need immediate attention?",
        context: { 
          lowStockProducts: inventoryData.filter(
            item => item.currentStock < item.lowStockThreshold
          ),
          totalLowStock: lowStockCount
        },
        category: "inventory"
      });
    }

    // Seasonal planning (always available)
    actions.push({
      icon: Calendar,
      label: "Seasonal Planning",
      question: "How should I prepare for the upcoming season?",
      context: { 
        currentMonth: new Date().toLocaleString('default', { month: 'long' }),
        hasSeasonalProducts: inventoryData.some(item => 
          item.product?.toLowerCase().includes('seasonal') || 
          item.product?.toLowerCase().includes('holiday')
        )
      },
      category: "planning"
    });

    return actions.slice(0, 4); // Limit to 4 actions
  };

  const quickActions = getQuickActions();

  if (quickActions.length === 0) {
    return null;
  }

  return (
    <div className={cn("p-4 bg-gray-800/50 rounded-lg border border-gray-700", className)}>
      <div className="flex items-center gap-2 mb-3">
        <MessageCircle className="h-4 w-4 text-blue-400" />
        <h3 className="text-sm font-medium text-gray-200">Quick AI Insights</h3>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {quickActions.map((action, index) => (
          <button
            key={index}
            onClick={() => openChatWithContext(action.question, action.context)}
            className="flex flex-col items-center gap-2 p-3 bg-gray-800/50 hover:bg-gray-700/50 rounded-lg border border-gray-700 transition-colors group"
          >
            <action.icon className={cn(
              "w-5 h-5 transition-colors",
              action.category === "purchasing" && "text-amber-400 group-hover:text-amber-300",
              action.category === "analytics" && "text-blue-400 group-hover:text-blue-300",
              action.category === "inventory" && "text-green-400 group-hover:text-green-300",
              action.category === "planning" && "text-purple-400 group-hover:text-purple-300"
            )} />
            <span className="text-xs text-gray-300 text-center group-hover:text-white transition-colors">
              {action.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Floating chat suggestion chip component
interface ChatSuggestionChipProps {
  text: string;
  context?: any;
  icon?: React.ElementType;
  className?: string;
}

export function ChatSuggestionChip({ 
  text, 
  context, 
  icon: Icon = MessageCircle,
  className 
}: ChatSuggestionChipProps) {
  const { setIsOpen, sendMessage } = useChat();

  const handleClick = () => {
    setIsOpen(true);
    setTimeout(() => {
      sendMessage(text, context);
    }, 100);
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-1",
        "bg-blue-900/20 hover:bg-blue-900/40",
        "text-blue-300 hover:text-blue-100",
        "text-xs rounded-md transition-colors",
        "border border-blue-500/30",
        className
      )}
    >
      <Icon className="w-3 h-3" />
      {text}
    </button>
  );
}

// Contextual chat trigger for inline use
interface ContextualChatTriggerProps {
  context: string;
  suggestion: string;
  className?: string;
}

export function ContextualChatTrigger({ 
  context, 
  suggestion,
  className 
}: ContextualChatTriggerProps) {
  const { setIsOpen, sendMessage } = useChat();

  const handleClick = () => {
    setIsOpen(true);
    setTimeout(() => {
      sendMessage(suggestion, { context });
    }, 100);
  };

  return (
    <div className={cn(
      "inline-flex items-center gap-2 p-2",
      "bg-blue-900/20 rounded-lg border border-blue-500/30",
      className
    )}>
      <div className="flex items-center gap-1 text-blue-300 text-sm">
        <MessageCircle className="w-4 h-4" />
        Ask AI:
      </div>
      <button 
        className="text-blue-100 text-sm hover:text-white transition-colors"
        onClick={handleClick}
      >
        &ldquo;{suggestion}&rdquo;
      </button>
    </div>
  );
}