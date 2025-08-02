"use client";

import React, { useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/hooks/useFocusTrap";

interface ChatPanelProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  children?: React.ReactNode;
  inputComponent?: React.ReactNode;
}

export function ChatPanel({ isOpen, onOpenChange, children, inputComponent }: ChatPanelProps) {
  const focusTrapRef = useFocusTrap(isOpen);

  // Handle Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onOpenChange(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onOpenChange]);

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <div ref={focusTrapRef}>
        <SheetContent
          side="right"
          className={cn(
            "w-full sm:w-[400px] md:w-[450px] p-0 flex flex-col",
            "bg-gray-900 border-gray-800",
            "focus:outline-none"
          )}
          aria-label="AI Assistant Chat Panel"
        >
        {/* Header */}
        <SheetHeader className="px-6 py-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center" aria-hidden="true">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <SheetTitle className="text-white">AI Assistant</SheetTitle>
              <SheetDescription className="text-gray-400">
                Ask me about your inventory
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Conversation View Container */}
          <div className="flex-1 overflow-hidden" role="log" aria-label="Chat messages" aria-live="polite">
            {children || (
              <ScrollArea className="h-full px-6 py-4">
                <div className="text-center text-gray-500 py-8">
                  <Bot className="w-12 h-12 mx-auto mb-3 text-gray-600" aria-hidden="true" />
                  <p>Start a conversation to get insights about your inventory</p>
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Input Area Container */}
          <SheetFooter className="border-t border-gray-800 p-4 sm:p-6">
            <div className="w-full" role="form" aria-label="Message input">
              {inputComponent || (
                <div className="text-gray-500 text-sm text-center">
                  Input area (to be implemented)
                </div>
              )}
            </div>
          </SheetFooter>
        </div>
      </SheetContent>
      </div>
    </Sheet>
  );
}