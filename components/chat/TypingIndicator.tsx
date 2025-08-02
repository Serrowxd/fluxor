"use client"

import React from 'react'
import { cn } from '@/lib/utils'

export interface TypingIndicatorProps {
  className?: string
  label?: string
}

export function TypingIndicator({ className, label = "AI is typing" }: TypingIndicatorProps) {
  return (
    <div 
      className={cn("flex items-center gap-2 text-gray-400", className)}
      role="status"
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
      <div className="flex gap-1 items-center">
        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
      </div>
      {label && (
        <span className="text-sm">{label}</span>
      )}
    </div>
  )
}