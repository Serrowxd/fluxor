"use client"

import React, { useEffect, useRef } from 'react'
import { MessageBubble, MessageBubbleProps } from './MessageBubble'
import { ScrollArea } from '@/components/ui/scroll-area'

export interface Message extends Omit<MessageBubbleProps, 'isTyping'> {
  id: string
}

export interface ConversationViewProps {
  messages: Message[]
  isTyping?: boolean
  className?: string
}

export function ConversationView({ messages, isTyping, className }: ConversationViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive or typing indicator appears
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, isTyping])

  // Check if we should show a welcome message
  const showWelcome = messages.length === 0 && !isTyping

  return (
    <ScrollArea className={`h-full ${className || ''}`} ref={scrollRef}>
      <div className="p-3 sm:p-4" role="log" aria-label="Chat messages" aria-live="polite">
        {/* Welcome message when no conversation */}
        {showWelcome && (
          <div className="text-center py-6 sm:py-8">
            <div className="inline-flex items-center justify-center w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-blue-600/10 mb-4" aria-hidden="true">
              <Bot className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
            </div>
            <h3 className="text-base sm:text-lg font-semibold text-gray-200 mb-2">
              Welcome to AI Assistant
            </h3>
            <p className="text-sm text-gray-400 max-w-sm mx-auto px-4 sm:px-0">
              I&apos;m here to help you with your inventory management questions. Ask me about forecasts, reorder suggestions, or seasonal trends!
            </p>
          </div>
        )}

        {/* Message list */}
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            content={message.content}
            role={message.role}
            timestamp={message.timestamp}
          />
        ))}

        {/* Typing indicator */}
        {isTyping && (
          <MessageBubble
            content=""
            role="assistant"
            isTyping={true}
          />
        )}

        {/* Scroll anchor */}
        <div ref={bottomRef} className="h-1" />
      </div>
    </ScrollArea>
  )
}

// Import Bot icon since it's used in the welcome message
import { Bot } from 'lucide-react'