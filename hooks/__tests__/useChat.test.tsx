import React from 'react'
import { renderHook, act } from '@testing-library/react'
import { useChat } from '../useChat'
import { AuthProvider } from '@/lib/auth-context'

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
  }),
  usePathname: () => '/',
}))

// Mock fetch
global.fetch = jest.fn()

// Mock feature flags
jest.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: jest.fn(() => true),
}))


// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
}
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

describe('useChat', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AuthProvider>{children}</AuthProvider>
  )

  beforeEach(() => {
    jest.clearAllMocks()
    localStorageMock.getItem.mockReturnValue(null)
    ;(fetch as jest.Mock).mockClear()
    // Mock the initial auth fetch
    ;(fetch as jest.Mock).mockImplementation((url) => {
      if (url === '/api/auth/user') {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: 'Unauthorized' })
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      })
    })
  })

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useChat(), { wrapper })
    
    expect(result.current.isOpen).toBe(false)
    expect(result.current.messages).toEqual([])
    expect(result.current.conversations).toEqual([])
    expect(result.current.currentConversationId).toBeNull()
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('should toggle panel open state', () => {
    const { result } = renderHook(() => useChat(), { wrapper })
    
    act(() => {
      result.current.toggleChat()
    })
    
    expect(result.current.isOpen).toBe(true)
    
    act(() => {
      result.current.toggleChat()
    })
    
    expect(result.current.isOpen).toBe(false)
  })

  it('should set panel open state directly', () => {
    const { result } = renderHook(() => useChat(), { wrapper })
    
    act(() => {
      result.current.openChat()
    })
    
    expect(result.current.isOpen).toBe(true)
    
    act(() => {
      result.current.closeChat()
    })
    
    expect(result.current.isOpen).toBe(false)
  })

  it('should send message successfully', async () => {
    const mockResponse = {
      conversationId: 'conv-123',
      message: 'AI response',
      confidence: 95,
      metadata: {
        intentCategory: 'general',
        processingTimeMs: 500,
        tokensUsed: 50
      }
    }
    
    ;(fetch as jest.Mock).mockImplementation((url) => {
      if (url === '/api/auth/user') {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: 'Unauthorized' })
        })
      }
      if (url === '/api/v1/chat/message') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResponse)
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      })
    })
    
    const { result } = renderHook(() => useChat(), { wrapper })
    
    await act(async () => {
      await result.current.sendMessage('Hello AI')
    })
    
    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      content: 'Hello AI'
    })
    
    expect(result.current.messages[1]).toMatchObject({
      role: 'assistant',
      content: 'AI response'
    })
    
    expect(result.current.currentConversationId).toBe('conv-123')
  })

  it('should handle send message error', async () => {
    ;(fetch as jest.Mock).mockImplementation((url) => {
      if (url === '/api/auth/user') {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: 'Unauthorized' })
        })
      }
      if (url === '/api/v1/chat/message') {
        return Promise.reject(new Error('Network error'))
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      })
    })
    
    const { result } = renderHook(() => useChat(), { wrapper })
    
    await act(async () => {
      await result.current.sendMessage('Hello AI')
    })
    
    expect(result.current.error).toBe('Network error')
    expect(result.current.messages).toHaveLength(1) // Only user message
  })

  it('should handle rate limit error', async () => {
    ;(fetch as jest.Mock).mockImplementation((url) => {
      if (url === '/api/auth/user') {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: 'Unauthorized' })
        })
      }
      if (url === '/api/v1/chat/message') {
        return Promise.resolve({
          ok: false,
          status: 429,
          json: () => Promise.resolve({ error: 'Rate limit exceeded' })
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      })
    })
    
    const { result } = renderHook(() => useChat(), { wrapper })
    
    await act(async () => {
      await result.current.sendMessage('Hello AI')
    })
    
    expect(result.current.error).toBe('Rate limit exceeded')
  })

  it('should set isSending when streaming', () => {
    const { result } = renderHook(() => useChat(), { wrapper })
    
    act(() => {
      result.current.sendMessageStream('Stream test')
    })
    
    expect(result.current.isSending).toBe(true)
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0].content).toBe('Stream test')
  })

  it('should load conversation history', async () => {
    ;(fetch as jest.Mock).mockImplementation((url) => {
      if (url === '/api/auth/user') {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: 'Unauthorized' })
        })
      }
      if (url === '/api/v1/chat/conversation/conv-123') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ messages: [
            { message_id: '1', message_type: 'user', content: 'Previous message', created_at: new Date().toISOString() },
            { message_id: '2', message_type: 'assistant', content: 'Previous response', created_at: new Date().toISOString() }
          ]})
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      })
    })
    
    const { result } = renderHook(() => useChat(), { wrapper })
    
    await act(async () => {
      await result.current.loadConversation('conv-123')
    })
    
    expect(result.current.messages).toHaveLength(2)
    expect(result.current.currentConversationId).toBe('conv-123')
  })

  it('should set conversations from loadConversations', async () => {
    ;(fetch as jest.Mock).mockImplementation((url) => {
      if (url === '/api/auth/user') {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: 'Unauthorized' })
        })
      }
      if (url === '/api/v1/chat/conversations') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ conversations: [
            {
              conversationId: 'conv-1',
              title: 'Chat 1',
              lastMessage: 'Last message',
              messageCount: 5,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          ]})
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      })
    })
    
    const { result } = renderHook(() => useChat(), { wrapper })
    
    await act(async () => {
      await result.current.loadConversations()
    })
    
    expect(result.current.conversations).toHaveLength(1)
    expect(result.current.conversations[0].id).toBe('conv-1')
  })

  it('should call delete API for deleteConversation', async () => {
    ;(fetch as jest.Mock).mockResolvedValueOnce({ ok: true })
    
    const { result } = renderHook(() => useChat(), { wrapper })
    
    await act(async () => {
      await result.current.deleteConversation('conv-1')
    })
    
    expect(fetch).toHaveBeenCalledWith('/api/v1/chat/conversation/conv-1', {
      method: 'DELETE',
      credentials: 'include'
    })
  })

  it('should clear messages', () => {
    const { result } = renderHook(() => useChat(), { wrapper })
    
    // Send a message first to populate messages
    act(() => {
      result.current.sendMessage('Test')
    })
    
    expect(result.current.messages).toHaveLength(1)
    
    act(() => {
      result.current.startNewConversation()
    })
    
    expect(result.current.messages).toHaveLength(0)
    expect(result.current.currentConversationId).toBeNull()
  })


})