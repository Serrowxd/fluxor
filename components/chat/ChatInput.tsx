"use client"

import React, { useState, useRef, KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Send } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ChatInputProps {
  onSendMessage: (message: string) => void
  disabled?: boolean
  placeholder?: string
  maxLength?: number
  className?: string
}

export function ChatInput({ 
  onSendMessage, 
  disabled = false,
  placeholder = "Type your message...",
  maxLength = 1000,
  className 
}: ChatInputProps) {
  const [message, setMessage] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSend = () => {
    const trimmedMessage = message.trim()
    if (trimmedMessage && !disabled) {
      onSendMessage(trimmedMessage)
      setMessage('')
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const charactersRemaining = maxLength - message.length
  const showCharacterWarning = charactersRemaining <= 100

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Input
            ref={inputRef}
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, maxLength))}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className={cn(
              "pr-12 bg-gray-800 border-gray-700 text-gray-100",
              "placeholder:text-gray-500 focus:border-blue-600",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
            aria-label="Chat message input"
          />
          {message.length > 0 && (
            <div 
              className={cn(
                "absolute right-2 top-1/2 -translate-y-1/2 text-xs",
                showCharacterWarning ? "text-orange-400" : "text-gray-500"
              )}
              aria-live="polite"
              aria-atomic="true"
            >
              <span className="sr-only">Characters remaining: </span>
              {charactersRemaining}
            </div>
          )}
        </div>
        <Button
          onClick={handleSend}
          disabled={disabled || !message.trim()}
          size="icon"
          className={cn(
            "bg-blue-600 hover:bg-blue-700 text-white",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            "transition-colors"
          )}
          aria-label="Send message"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
      
      {/* Character limit warning */}
      {showCharacterWarning && message.length > 0 && (
        <p 
          className="text-xs text-orange-400"
          role="alert"
          aria-live="assertive"
        >
          {charactersRemaining === 0 
            ? "Character limit reached" 
            : `${charactersRemaining} characters remaining`}
        </p>
      )}
    </div>
  )
}