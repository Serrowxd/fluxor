"use client"

import React from 'react'
import { cn } from '@/lib/utils'
import { Bot, User } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

export interface MessageBubbleProps {
  content: string
  role: 'user' | 'assistant'
  timestamp?: Date
  isTyping?: boolean
}

export function MessageBubble({ content, role, timestamp, isTyping }: MessageBubbleProps) {
  const isUser = role === 'user'

  const formatTime = (date?: Date) => {
    if (!date) return ''
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: 'numeric',
      hour12: true
    }).format(date)
  }

  return (
    <div 
      className={cn(
        'flex gap-2 sm:gap-3 mb-4 animate-in fade-in-0 slide-in-from-bottom-2 duration-300',
        isUser && 'flex-row-reverse'
      )}
      role="article"
      aria-label={`${role} message`}
    >
      {/* Avatar */}
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
          isUser ? 'bg-gray-700' : 'bg-blue-600'
        )}
        aria-hidden="true"
      >
        {isUser ? (
          <User className="w-5 h-5 text-gray-200" />
        ) : (
          <Bot className="w-5 h-5 text-white" />
        )}
      </div>

      {/* Message Content */}
      <div className={cn('flex flex-col gap-1', isUser && 'items-end')}>
        <div
          className={cn(
            'px-3 sm:px-4 py-2 rounded-lg max-w-[85%] sm:max-w-[80%] break-words',
            isUser
              ? 'bg-gray-700 text-gray-100'
              : 'bg-gray-800 text-gray-100 border border-gray-700'
          )}
        >
          {isTyping ? (
            <div className="flex gap-1 items-center h-5" role="status" aria-label="AI is typing">
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]" aria-hidden="true" />
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]" aria-hidden="true" />
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" aria-hidden="true" />
              <span className="sr-only">AI is typing</span>
            </div>
          ) : (
            <div className="text-sm">
              <ReactMarkdown 
                components={{
                  p: ({children}) => <p className="my-1">{children}</p>,
                  strong: ({children}) => <strong className="font-semibold text-gray-100">{children}</strong>,
                  em: ({children}) => <em className="text-gray-200">{children}</em>,
                  code: ({children}) => <code className="text-blue-300 bg-gray-800 px-1 py-0.5 rounded text-xs">{children}</code>,
                  pre: ({children}) => <pre className="bg-gray-800 border border-gray-700 p-2 rounded my-2 overflow-x-auto">{children}</pre>,
                }}
              >
                {content}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Timestamp */}
        {timestamp && !isTyping && (
          <time className="text-xs text-gray-500 px-1" dateTime={timestamp.toISOString()}>
            {formatTime(timestamp)}
          </time>
        )}
      </div>
    </div>
  )
}