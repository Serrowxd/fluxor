"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface HelpTooltipProps {
  content: string;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
}

export function HelpTooltip({ 
  content, 
  className,
  side = "top" 
}: HelpTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <button
            className={cn(
              "inline-flex items-center justify-center rounded-full",
              "h-4 w-4 hover:bg-muted transition-colors",
              "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary",
              className
            )}
            aria-label="Help information"
          >
            <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </TooltipTrigger>
        <TooltipContent 
          side={side}
          className="max-w-xs text-sm"
        >
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}