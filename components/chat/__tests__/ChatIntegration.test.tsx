import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatTrigger } from '../ChatTrigger'
import { ChatPanel } from '../ChatPanel'
import { ConversationView } from '../ConversationView'
import { ChatInput } from '../ChatInput'
import { useChat } from '@/hooks/useChat'

// Mock the useChat hook
jest.mock('@/hooks/useChat')

// Simple Chat UI Component for testing
function ChatUI() {
  const chat = useChat()
  
  return (
    <>
      <ChatTrigger onClick={() => chat.setIsOpen(true)} />
      <ChatPanel 
        isOpen={chat.isOpen} 
        onOpenChange={chat.setIsOpen}
        inputComponent={
          <ChatInput 
            onSendMessage={chat.sendMessage}
            disabled={chat.isLoading}
          />
        }
      >
        <ConversationView 
          messages={chat.messages} 
          isTyping={chat.isLoading}
          className="h-full"
        />
      </ChatPanel>
    </>
  )
}

describe('Chat UI Basic Tests', () => {
  const mockChat = {
    isOpen: false,
    setIsOpen: jest.fn(),
    messages: [],
    conversations: [],
    currentConversation: null,
    isLoading: false,
    error: null,
    sendMessage: jest.fn(),
    streamMessage: jest.fn(),
    loadConversations: jest.fn(),
    loadConversation: jest.fn(),
    deleteConversation: jest.fn(),
    clearMessages: jest.fn(),
    togglePanel: jest.fn(),
    setMessages: jest.fn()
  }

  beforeEach(() => {
    jest.clearAllMocks()
    ;(useChat as jest.Mock).mockReturnValue(mockChat)
  })

  it('should render chat trigger button', () => {
    render(<ChatUI />)
    const trigger = screen.getByRole('button', { name: /open chat assistant/i })
    expect(trigger).toBeInTheDocument()
  })

  it('should open panel when trigger is clicked', async () => {
    const user = userEvent.setup()
    render(<ChatUI />)
    
    const trigger = screen.getByRole('button', { name: /open chat assistant/i })
    await user.click(trigger)
    
    expect(mockChat.setIsOpen).toHaveBeenCalledWith(true)
  })

  it('should handle keyboard shortcut', () => {
    render(<ChatUI />)
    
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    
    expect(mockChat.setIsOpen).toHaveBeenCalledWith(true)
  })

  it('should display messages when provided', () => {
    const messages = [
      { id: '1', role: 'user', content: 'Hello', timestamp: new Date() },
      { id: '2', role: 'assistant', content: 'Hi there!', timestamp: new Date() }
    ]
    
    ;(useChat as jest.Mock).mockReturnValue({ 
      ...mockChat, 
      isOpen: true,
      messages
    })
    
    render(<ChatUI />)
    
    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(screen.getByText('Hi there!')).toBeInTheDocument()
  })

  it('should disable input while loading', () => {
    ;(useChat as jest.Mock).mockReturnValue({ 
      ...mockChat, 
      isOpen: true,
      isLoading: true
    })
    
    render(<ChatUI />)
    
    const input = screen.getByRole('textbox')
    expect(input).toBeDisabled()
  })

  it('should send message when enter is pressed', async () => {
    const user = userEvent.setup()
    ;(useChat as jest.Mock).mockReturnValue({ 
      ...mockChat, 
      isOpen: true
    })
    
    render(<ChatUI />)
    
    const input = screen.getByRole('textbox')
    await user.type(input, 'Test message')
    await user.keyboard('{Enter}')
    
    expect(mockChat.sendMessage).toHaveBeenCalledWith('Test message')
  })
})