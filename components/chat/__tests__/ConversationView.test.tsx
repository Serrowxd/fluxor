import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { ConversationView, Message } from '../ConversationView'

describe('ConversationView', () => {
  const mockMessages: Message[] = [
    {
      id: '1',
      content: 'Hello, I need help',
      role: 'user',
      timestamp: new Date('2024-01-15T10:00:00')
    },
    {
      id: '2',
      content: 'Sure, I can help you!',
      role: 'assistant',
      timestamp: new Date('2024-01-15T10:01:00')
    }
  ]

  it('should render all messages', () => {
    render(<ConversationView messages={mockMessages} />)
    
    expect(screen.getByText('Hello, I need help')).toBeInTheDocument()
    expect(screen.getByText('Sure, I can help you!')).toBeInTheDocument()
  })

  it('should show welcome message when no messages', () => {
    render(<ConversationView messages={[]} />)
    
    expect(screen.getByText('Welcome to AI Assistant')).toBeInTheDocument()
    expect(screen.getByText(/I'm here to help you with your inventory management/)).toBeInTheDocument()
  })

  it('should not show welcome message when there are messages', () => {
    render(<ConversationView messages={mockMessages} />)
    
    expect(screen.queryByText('Welcome to AI Assistant')).not.toBeInTheDocument()
  })

  it('should show typing indicator when isTyping is true', () => {
    render(<ConversationView messages={mockMessages} isTyping={true} />)
    
    // Check for typing indicator
    const typingIndicator = screen.getByRole('status')
    expect(typingIndicator).toBeInTheDocument()
    
    // Should have bouncing dots
    const dots = typingIndicator.querySelectorAll('.animate-bounce')
    expect(dots).toHaveLength(3)
  })

  it('should not show typing indicator when isTyping is false', () => {
    render(<ConversationView messages={mockMessages} isTyping={false} />)
    
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('should auto-scroll to bottom when new messages are added', async () => {
    const { rerender } = render(<ConversationView messages={mockMessages} />)
    
    // Mock scrollIntoView
    const scrollIntoViewMock = jest.fn()
    Element.prototype.scrollIntoView = scrollIntoViewMock
    
    // Add a new message
    const newMessage: Message = {
      id: '3',
      content: 'New message',
      role: 'user',
      timestamp: new Date()
    }
    
    rerender(<ConversationView messages={[...mockMessages, newMessage]} />)
    
    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth' })
    })
  })

  it('should auto-scroll when typing indicator appears', async () => {
    const scrollIntoViewMock = jest.fn()
    Element.prototype.scrollIntoView = scrollIntoViewMock
    
    const { rerender } = render(<ConversationView messages={mockMessages} isTyping={false} />)
    
    rerender(<ConversationView messages={mockMessages} isTyping={true} />)
    
    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth' })
    })
  })

  it('should apply custom className', () => {
    const { container } = render(
      <ConversationView messages={mockMessages} className="custom-class" />
    )
    
    const scrollArea = container.querySelector('[data-radix-scroll-area-viewport]')?.parentElement
    expect(scrollArea).toHaveClass('custom-class')
  })

  it('should have proper ARIA attributes', () => {
    render(<ConversationView messages={mockMessages} />)
    
    // Check for message list role
    const messageList = screen.getByRole('log')
    expect(messageList).toBeInTheDocument()
    expect(messageList).toHaveAttribute('aria-live', 'polite')
    expect(messageList).toHaveAttribute('aria-label', 'Chat messages')
  })

  it('should render messages in correct order', () => {
    render(<ConversationView messages={mockMessages} />)
    
    const articles = screen.getAllByRole('article')
    expect(articles).toHaveLength(2)
    
    // First message should be from user
    expect(articles[0]).toHaveTextContent('Hello, I need help')
    
    // Second message should be from assistant
    expect(articles[1]).toHaveTextContent('Sure, I can help you!')
  })

  it('should handle empty message content gracefully', () => {
    const messagesWithEmpty: Message[] = [
      ...mockMessages,
      {
        id: '3',
        content: '',
        role: 'user',
        timestamp: new Date()
      }
    ]
    
    render(<ConversationView messages={messagesWithEmpty} />)
    
    // Should still render all message containers
    const articles = screen.getAllByRole('article')
    expect(articles).toHaveLength(3)
  })

  it('should show typing indicator after all messages', () => {
    render(<ConversationView messages={mockMessages} isTyping={true} />)
    
    const articles = screen.getAllByRole('article')
    const lastArticle = articles[articles.length - 1]
    
    // Typing indicator should be in the last article
    const typingIndicator = lastArticle.querySelector('[role="status"]')
    expect(typingIndicator).toBeInTheDocument()
  })
})