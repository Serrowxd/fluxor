"use client";

import React, { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatTriggerProps {
  onClick: () => void;
  className?: string;
}

export function ChatTrigger({ onClick, className }: ChatTriggerProps) {
  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Check for Ctrl+K (Windows/Linux) or Cmd+K (Mac)
      if ((event.ctrlKey || event.metaKey) && event.key === "k") {
        event.preventDefault();
        onClick();
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [onClick]);

  return (
    <Button
      onClick={onClick}
      size="icon"
      className={cn(
        "fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg",
        "bg-blue-600 hover:bg-blue-700 text-white",
        "transition-all duration-200 hover:scale-105",
        "focus:outline-none focus:ring-4 focus:ring-blue-500/20",
        className
      )}
      aria-label="Open chat assistant (Ctrl+K)"
      title="Chat with AI Assistant (Ctrl+K)"
    >
      <MessageCircle className="h-6 w-6" />
    </Button>
  );
}