"use client"

import { useState, useEffect, useCallback, useRef } from 'react'
import { Message } from '@/components/chat/ConversationView'
import { useAuth } from '@/lib/auth-context'

export interface ChatState {
  isOpen: boolean
  messages: Message[]
  conversations: Conversation[]
  currentConversationId: string | null
  isLoading: boolean
  isSending: boolean
  error: string | null
}

export interface Conversation {
  id: string
  title: string
  lastMessage: string
  messageCount: number
  createdAt: Date
  updatedAt: Date
}

export interface ChatResponse {
  conversationId: string
  message: string
  confidence: number
  metadata?: {
    intentCategory: string
    processingTimeMs: number
    tokensUsed: number
  }
}

export interface StreamEvent {
  type: 'typing' | 'message' | 'error' | 'complete'
  data: any
}

const STORAGE_KEY = 'fluxor-chat-state'

export function useChat() {
  const { user } = useAuth()
  
  // Check if this is a dev or demo user
  const isDevUser = user?.user_id === "dev-user-123"
  const isDemoUser = user?.user_id === "demo-user-456"
  const isDemoOrDevUser = isDevUser || isDemoUser

  // State management
  const [state, setState] = useState<ChatState>({
    isOpen: false,
    messages: [],
    conversations: [],
    currentConversationId: null,
    isLoading: false,
    isSending: false,
    error: null
  })

  // Refs for SSE and cleanup
  const eventSourceRef = useRef<EventSource | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Demo data for demo/dev users
  const demoMessages: Message[] = [
    {
      id: 'demo-1',
      role: 'user',
      content: 'What products need reordering soon?',
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago
    },
    {
      id: 'demo-2',
      role: 'assistant',
      content: 'Based on current inventory levels and sales velocity, I found 3 products that need immediate attention:\n\n1. **Denim Jeans (JNS-BLU-32)** - Critical\n   - Current stock: 15 units\n   - Predicted demand: 45 units\n   - Suggested reorder: 30 units\n   - Lead time: 7 days\n\n2. **Winter Jacket (JKT-WIN-L)** - Critical\n   - Current stock: 8 units\n   - Predicted demand: 35 units\n   - Suggested reorder: 27 units\n   - Lead time: 14 days\n\n3. **Sunglasses (SUN-POL-BLK)** - Medium Priority\n   - Current stock: 12 units\n   - Predicted demand: 30 units\n   - Suggested reorder: 18 units\n   - Lead time: 5 days\n\nWould you like me to help you create purchase orders for these items?',
      timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000 + 30000) // 2 hours ago + 30 seconds
    },
    {
      id: 'demo-3',
      role: 'user',
      content: 'Show me the sales trend for Classic T-Shirt',
      timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000) // 1 hour ago
    },
    {
      id: 'demo-4',
      role: 'assistant',
      content: 'Here\'s the sales analysis for Classic T-Shirt (TSH-CLS-M):\n\n📈 **Sales Performance**\n- Last 7 days: 156 units sold\n- Average daily sales: 22.3 units\n- Revenue generated: $3,666\n- Trend: +15% compared to last week\n\n📊 **Inventory Metrics**\n- Current stock: 45 units\n- Days of supply: ~2 days\n- Turnover ratio: 6.0 (Excellent)\n- Gross margin: 63.8%\n\nThe product is performing very well with strong sales velocity. At the current rate, you\'ll need to reorder within 2 days to avoid stockouts. The high turnover ratio indicates this is one of your best-performing products.',
      timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000 + 30000) // 1 hour ago + 30 seconds
    },
    {
      id: 'demo-5',
      role: 'user',
      content: 'What\'s causing the stockouts for Denim Jeans?',
      timestamp: new Date(Date.now() - 30 * 60 * 1000) // 30 minutes ago
    },
    {
      id: 'demo-6',
      role: 'assistant',
      content: 'I\'ve analyzed the stockout pattern for Denim Jeans (JNS-BLU-32):\n\n🔍 **Stockout Analysis**\n- Total stockout events: 3 in the last month\n- Duration: 72 hours total (3 days)\n- Lost sales: 15 units (~$1,125 in revenue)\n\n📌 **Root Causes**\n1. **Demand Underestimation**: Actual demand exceeded forecast by 16.5%\n2. **Long Lead Time**: 7-day supplier lead time doesn\'t match sales velocity\n3. **Reorder Timing**: Orders placed too late (when stock < 10 units)\n\n💡 **Recommendations**\n- Increase safety stock from 10 to 20 units\n- Set reorder point at 35 units (not 25)\n- Consider negotiating shorter lead times with supplier\n- Enable automatic reordering to prevent delays\n\nImplementing these changes should reduce stockout rate from 3.4% to under 1%.',
      timestamp: new Date(Date.now() - 30 * 60 * 1000 + 30000) // 30 minutes ago + 30 seconds
    }
  ]

  const demoConversations: Conversation[] = [
    {
      id: 'demo-conv-1',
      title: 'Reorder Analysis',
      lastMessage: 'Based on current inventory levels and sales velocity...',
      messageCount: 2,
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000)
    },
    {
      id: 'demo-conv-2',
      title: 'Classic T-Shirt Sales',
      lastMessage: 'The product is performing very well with strong sales velocity...',
      messageCount: 2,
      createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
      updatedAt: new Date(Date.now() - 1 * 60 * 60 * 1000)
    },
    {
      id: 'demo-conv-3',
      title: 'Denim Jeans Stockouts',
      lastMessage: 'Implementing these changes should reduce stockout rate...',
      messageCount: 2,
      createdAt: new Date(Date.now() - 30 * 60 * 1000),
      updatedAt: new Date(Date.now() - 30 * 60 * 1000)
    }
  ]

  // Load from local storage on mount
  useEffect(() => {
    if (isDemoOrDevUser) {
      // Load demo data for demo/dev users
      setState(prev => ({
        ...prev,
        messages: demoMessages,
        conversations: demoConversations,
        currentConversationId: 'demo-conv-3'
      }))
    } else {
      // Load from localStorage for real users
      const savedState = localStorage.getItem(STORAGE_KEY)
      if (savedState) {
        try {
          const parsed = JSON.parse(savedState)
          setState(prev => ({
            ...prev,
            conversations: parsed.conversations || [],
            currentConversationId: parsed.currentConversationId || null
          }))
        } catch (error) {
          console.error('Failed to load chat state:', error)
        }
      }
    }
  }, [isDemoOrDevUser])

  // Save conversations to local storage
  useEffect(() => {
    const dataToSave = {
      conversations: state.conversations,
      currentConversationId: state.currentConversationId
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave))
  }, [state.conversations, state.currentConversationId])

  // Panel control
  const openChat = useCallback(() => {
    setState(prev => ({ ...prev, isOpen: true }))
  }, [])

  const closeChat = useCallback(() => {
    setState(prev => ({ ...prev, isOpen: false }))
    // Clean up any active SSE connections
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
  }, [])

  const toggleChat = useCallback(() => {
    setState(prev => ({ ...prev, isOpen: !prev.isOpen }))
  }, [])

  // Load conversation history
  const loadConversation = useCallback(async (conversationId: string) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }))
    
    try {
      const response = await fetch(`/api/v1/chat/conversation/${conversationId}`, {
        method: 'GET',
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error('Failed to load conversation')
      }

      const data = await response.json()
      const messages: Message[] = data.messages.map((msg: any) => ({
        id: msg.message_id,
        role: msg.message_type === 'user' ? 'user' : 'assistant',
        content: msg.content,
        timestamp: new Date(msg.created_at)
      }))

      setState(prev => ({
        ...prev,
        messages,
        currentConversationId: conversationId,
        isLoading: false
      }))
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to load conversation',
        isLoading: false
      }))
    }
  }, [])

  // Load conversations list
  const loadConversations = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/chat/conversations', {
        method: 'GET',
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error('Failed to load conversations')
      }

      const data = await response.json()
      const conversations: Conversation[] = data.conversations.map((conv: any) => ({
        id: conv.conversationId,
        title: conv.title,
        lastMessage: conv.lastMessage,
        messageCount: conv.messageCount,
        createdAt: new Date(conv.createdAt),
        updatedAt: new Date(conv.updatedAt)
      }))

      setState(prev => ({ ...prev, conversations }))
    } catch (error) {
      console.error('Failed to load conversations:', error)
    }
  }, [])

  // Send message with standard API
  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || state.isSending) return

    // Add user message immediately
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date()
    }

    setState(prev => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      isSending: true,
      error: null
    }))

    // For demo users, simulate a response
    if (isDemoOrDevUser) {
      setTimeout(() => {
        const demoResponses = [
          'I can help you analyze that. Based on your current inventory data, I see several insights we can explore. What specific aspect would you like to focus on?',
          'Looking at your sales patterns, I notice some interesting trends. The data shows fluctuations that might be seasonal. Would you like me to break down the analysis by product category?',
          'I\'ve reviewed your inventory levels. There are optimization opportunities in your reorder points. Shall I provide specific recommendations for your top-selling items?',
          'Based on the forecast models, demand is expected to increase by 15% next month. This is driven primarily by seasonal factors. Would you like a detailed breakdown?',
          'Your inventory turnover ratio is performing well at 4.8, which is above industry average. However, there\'s room for improvement in specific categories. Interested in the details?'
        ]
        
        const assistantMessage: Message = {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: demoResponses[Math.floor(Math.random() * demoResponses.length)],
          timestamp: new Date()
        }

        setState(prev => ({
          ...prev,
          messages: [...prev.messages, assistantMessage],
          isSending: false
        }))
      }, 1000)
      return
    }

    try {
      const response = await fetch('/api/v1/chat/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          message: content,
          conversationId: state.currentConversationId
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to send message')
      }

      const data: ChatResponse = await response.json()

      // Add assistant response
      const assistantMessage: Message = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: data.message,
        timestamp: new Date()
      }

      setState(prev => ({
        ...prev,
        messages: [...prev.messages, assistantMessage],
        currentConversationId: data.conversationId,
        isSending: false
      }))

      // Reload conversations to update the list
      loadConversations()
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to send message',
        isSending: false
      }))
    }
  }, [state.currentConversationId, state.isSending, loadConversations, isDemoOrDevUser])

  // Send message with SSE streaming
  const sendMessageStream = useCallback(async (content: string) => {
    if (!content.trim() || state.isSending) return

    // Clean up any existing SSE connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    // Add user message
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date()
    }

    setState(prev => ({
      ...prev,
      messages: [...prev.messages, userMessage],
      isSending: true,
      error: null
    }))

    try {
      // Create abort controller for cleanup
      abortControllerRef.current = new AbortController()

      // Send initial request to get SSE stream
      const response = await fetch('/api/v1/chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        signal: abortControllerRef.current.signal,
        body: JSON.stringify({
          message: content,
          conversationId: state.currentConversationId
        })
      })

      if (!response.ok) {
        throw new Error('Failed to start stream')
      }

      // Set up SSE
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error('No response body')
      }

      let assistantMessage: Message | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event: StreamEvent = JSON.parse(line.slice(6))

              switch (event.type) {
                case 'typing':
                  // Show typing indicator
                  setState(prev => ({ ...prev, isSending: true }))
                  break

                case 'message':
                  // Create or update assistant message
                  if (!assistantMessage) {
                    assistantMessage = {
                      id: `msg-${Date.now()}`,
                      role: 'assistant',
                      content: event.data.content,
                      timestamp: new Date()
                    }
                    setState(prev => ({
                      ...prev,
                      messages: [...prev.messages, assistantMessage!]
                    }))
                  } else {
                    // Update existing message if streaming chunks
                    setState(prev => ({
                      ...prev,
                      messages: prev.messages.map(msg =>
                        msg.id === assistantMessage!.id
                          ? { ...msg, content: event.data.content }
                          : msg
                      )
                    }))
                  }
                  break

                case 'error':
                  throw new Error(event.data.message || 'Stream error')

                case 'complete':
                  setState(prev => ({ ...prev, isSending: false }))
                  loadConversations()
                  break
              }
            } catch (e) {
              console.error('Failed to parse SSE event:', e)
            }
          }
        }
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to send message',
        isSending: false
      }))
    }
  }, [state.currentConversationId, state.isSending, loadConversations])

  // Start new conversation
  const startNewConversation = useCallback(() => {
    setState(prev => ({
      ...prev,
      messages: [],
      currentConversationId: null,
      error: null
    }))
  }, [])

  // Delete conversation
  const deleteConversation = useCallback(async (conversationId: string) => {
    try {
      const response = await fetch(`/api/v1/chat/conversation/${conversationId}`, {
        method: 'DELETE',
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error('Failed to delete conversation')
      }

      // Remove from local state
      setState(prev => ({
        ...prev,
        conversations: prev.conversations.filter(c => c.id !== conversationId),
        currentConversationId: prev.currentConversationId === conversationId ? null : prev.currentConversationId,
        messages: prev.currentConversationId === conversationId ? [] : prev.messages
      }))
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to delete conversation'
      }))
    }
  }, [])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  return {
    // State
    isOpen: state.isOpen,
    messages: state.messages,
    conversations: state.conversations,
    currentConversationId: state.currentConversationId,
    isLoading: state.isLoading,
    isSending: state.isSending,
    error: state.error,

    // Actions
    openChat,
    closeChat,
    toggleChat,
    sendMessage,
    sendMessageStream,
    loadConversation,
    loadConversations,
    startNewConversation,
    deleteConversation
  }
}