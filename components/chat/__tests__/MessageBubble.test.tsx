import React from 'react'
import { render, screen } from '@testing-library/react'
import { MessageBubble } from '../MessageBubble'

describe('MessageBubble', () => {
  const mockDate = new Date('2024-01-15T10:30:00')

  it('should render user message with correct styling', () => {
    render(
      <MessageBubble 
        content="Hello, I need help" 
        role="user" 
        timestamp={mockDate}
      />
    )
    
    const message = screen.getByText('Hello, I need help')
    expect(message).toBeInTheDocument()
    
    // Check for user-specific classes
    const messageContainer = message.closest('div')
    expect(messageContainer).toHaveClass('bg-gray-700', 'text-gray-100')
    
    // Check for right alignment
    const wrapper = messageContainer?.parentElement?.parentElement
    expect(wrapper).toHaveClass('flex-row-reverse')
  })

  it('should render assistant message with correct styling', () => {
    render(
      <MessageBubble 
        content="I can help you with that" 
        role="assistant" 
        timestamp={mockDate}
      />
    )
    
    const message = screen.getByText('I can help you with that')
    expect(message).toBeInTheDocument()
    
    // Check for assistant-specific classes
    const messageContainer = message.closest('div')
    expect(messageContainer).toHaveClass('bg-gray-800', 'text-gray-100', 'border', 'border-gray-700')
  })

  it('should display correct avatar icons', () => {
    const { rerender } = render(
      <MessageBubble content="User message" role="user" />
    )
    
    // User should have User icon
    let avatar = screen.getByRole('article').querySelector('.bg-gray-700')
    expect(avatar).toBeInTheDocument()
    
    rerender(
      <MessageBubble content="Assistant message" role="assistant" />
    )
    
    // Assistant should have Bot icon with blue background
    avatar = screen.getByRole('article').querySelector('.bg-blue-600')
    expect(avatar).toBeInTheDocument()
  })

  it('should format and display timestamp correctly', () => {
    render(
      <MessageBubble 
        content="Test message" 
        role="user" 
        timestamp={mockDate}
      />
    )
    
    // Check for formatted time (10:30 AM format)
    const timeElement = screen.getByText(/10:30/i)
    expect(timeElement).toBeInTheDocument()
    expect(timeElement.tagName).toBe('TIME')
    expect(timeElement).toHaveAttribute('dateTime', mockDate.toISOString())
  })

  it('should not display timestamp when not provided', () => {
    render(
      <MessageBubble content="Test message" role="user" />
    )
    
    // Should not find any time element
    const timeElement = screen.queryByText(/\d{1,2}:\d{2}/i)
    expect(timeElement).not.toBeInTheDocument()
  })

  it('should show typing indicator when isTyping is true', () => {
    render(
      <MessageBubble content="" role="assistant" isTyping={true} />
    )
    
    // Check for bouncing dots
    const dots = screen.getByRole('article').querySelectorAll('.animate-bounce')
    expect(dots).toHaveLength(3)
  })

  it('should not show content when typing', () => {
    render(
      <MessageBubble 
        content="This should not appear" 
        role="assistant" 
        isTyping={true}
      />
    )
    
    expect(screen.queryByText('This should not appear')).not.toBeInTheDocument()
  })

  it('should have proper ARIA attributes', () => {
    render(
      <MessageBubble 
        content="Accessible message" 
        role="user" 
        timestamp={mockDate}
      />
    )
    
    const article = screen.getByRole('article')
    expect(article).toBeInTheDocument()
    
    // Icons should be decorative
    const icons = article.querySelectorAll('[aria-hidden="true"]')
    expect(icons.length).toBeGreaterThan(0)
  })

  it('should handle long messages with proper text wrapping', () => {
    const longMessage = 'This is a very long message that should wrap properly and not overflow the container. It contains multiple sentences to test the text wrapping behavior.'
    
    render(
      <MessageBubble content={longMessage} role="user" />
    )
    
    const message = screen.getByText(longMessage)
    const container = message.closest('div')
    expect(container).toHaveClass('break-words')
  })

  it('should preserve whitespace in messages', () => {
    const messageWithNewlines = 'Line 1\nLine 2\nLine 3'
    
    render(
      <MessageBubble content={messageWithNewlines} role="user" />
    )
    
    const message = screen.getByText(/Line 1/)
    expect(message).toHaveClass('whitespace-pre-wrap')
  })

  it('should have animation classes', () => {
    render(
      <MessageBubble content="Animated message" role="user" />
    )
    
    const wrapper = screen.getByRole('article')
    expect(wrapper).toHaveClass('animate-in', 'fade-in-0', 'slide-in-from-bottom-2')
  })
})