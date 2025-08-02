import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatInput } from '../ChatInput'

describe('ChatInput', () => {
  const mockOnSendMessage = jest.fn()

  beforeEach(() => {
    mockOnSendMessage.mockClear()
  })

  it('should render input and send button', () => {
    render(<ChatInput onSendMessage={mockOnSendMessage} />)
    
    expect(screen.getByRole('textbox', { name: /chat message input/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send message/i })).toBeInTheDocument()
  })

  it('should update input value when typing', async () => {
    const user = userEvent.setup()
    render(<ChatInput onSendMessage={mockOnSendMessage} />)
    
    const input = screen.getByRole('textbox')
    await user.type(input, 'Hello world')
    
    expect(input).toHaveValue('Hello world')
  })

  it('should send message when send button is clicked', async () => {
    const user = userEvent.setup()
    render(<ChatInput onSendMessage={mockOnSendMessage} />)
    
    const input = screen.getByRole('textbox')
    const sendButton = screen.getByRole('button', { name: /send message/i })
    
    await user.type(input, 'Test message')
    await user.click(sendButton)
    
    expect(mockOnSendMessage).toHaveBeenCalledWith('Test message')
    expect(input).toHaveValue('') // Input should be cleared
  })

  it('should send message when Enter key is pressed', async () => {
    const user = userEvent.setup()
    render(<ChatInput onSendMessage={mockOnSendMessage} />)
    
    const input = screen.getByRole('textbox')
    await user.type(input, 'Test message')
    await user.keyboard('{Enter}')
    
    expect(mockOnSendMessage).toHaveBeenCalledWith('Test message')
    expect(input).toHaveValue('')
  })

  it('should not send message when Shift+Enter is pressed', async () => {
    const user = userEvent.setup()
    render(<ChatInput onSendMessage={mockOnSendMessage} />)
    
    const input = screen.getByRole('textbox')
    await user.type(input, 'Test message')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    
    expect(mockOnSendMessage).not.toHaveBeenCalled()
    expect(input).toHaveValue('Test message')
  })

  it('should not send empty messages', async () => {
    const user = userEvent.setup()
    render(<ChatInput onSendMessage={mockOnSendMessage} />)
    
    const sendButton = screen.getByRole('button', { name: /send message/i })
    await user.click(sendButton)
    
    expect(mockOnSendMessage).not.toHaveBeenCalled()
  })

  it('should trim whitespace before sending', async () => {
    const user = userEvent.setup()
    render(<ChatInput onSendMessage={mockOnSendMessage} />)
    
    const input = screen.getByRole('textbox')
    await user.type(input, '  Test message  ')
    await user.keyboard('{Enter}')
    
    expect(mockOnSendMessage).toHaveBeenCalledWith('Test message')
  })

  it('should disable input and button when disabled prop is true', () => {
    render(<ChatInput onSendMessage={mockOnSendMessage} disabled={true} />)
    
    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: /send message/i })).toBeDisabled()
  })

  it('should show character count when typing', async () => {
    const user = userEvent.setup()
    render(<ChatInput onSendMessage={mockOnSendMessage} />)
    
    const input = screen.getByRole('textbox')
    await user.type(input, 'Hello')
    
    expect(screen.getByText('995')).toBeInTheDocument() // 1000 - 5
  })

  it('should show warning when approaching character limit', async () => {
    const user = userEvent.setup()
    render(<ChatInput onSendMessage={mockOnSendMessage} maxLength={150} />)
    
    const input = screen.getByRole('textbox')
    const longText = 'a'.repeat(100)
    await user.type(input, longText)
    
    // Should show remaining characters with warning color
    expect(screen.getByText('50')).toBeInTheDocument()
    expect(screen.getByText('50')).toHaveClass('text-orange-400')
  })

  it('should show character limit reached message', async () => {
    const user = userEvent.setup()
    render(<ChatInput onSendMessage={mockOnSendMessage} maxLength={10} />)
    
    const input = screen.getByRole('textbox')
    await user.type(input, '1234567890')
    
    expect(screen.getByText('Character limit reached')).toBeInTheDocument()
  })

  it('should enforce character limit', async () => {
    const user = userEvent.setup()
    render(<ChatInput onSendMessage={mockOnSendMessage} maxLength={10} />)
    
    const input = screen.getByRole('textbox')
    await user.type(input, '12345678901234') // Try to type more than limit
    
    expect(input).toHaveValue('1234567890') // Should be truncated
  })

  it('should use custom placeholder', () => {
    render(
      <ChatInput 
        onSendMessage={mockOnSendMessage} 
        placeholder="Ask a question..."
      />
    )
    
    expect(screen.getByPlaceholderText('Ask a question...')).toBeInTheDocument()
  })

  it('should apply custom className', () => {
    render(
      <ChatInput 
        onSendMessage={mockOnSendMessage} 
        className="custom-class"
      />
    )
    
    const container = screen.getByRole('textbox').closest('.space-y-2')
    expect(container).toHaveClass('custom-class')
  })

  it('should focus input after sending message', async () => {
    const user = userEvent.setup()
    render(<ChatInput onSendMessage={mockOnSendMessage} />)
    
    const input = screen.getByRole('textbox')
    await user.type(input, 'Test message')
    await user.keyboard('{Enter}')
    
    expect(input).toHaveFocus()
  })

  it('should have proper ARIA attributes', () => {
    render(<ChatInput onSendMessage={mockOnSendMessage} />)
    
    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('aria-label', 'Chat message input')
    
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-label', 'Send message')
  })

  it('should show character count with aria-live for screen readers', async () => {
    const user = userEvent.setup()
    render(<ChatInput onSendMessage={mockOnSendMessage} />)
    
    const input = screen.getByRole('textbox')
    await user.type(input, 'Hello')
    
    const charCount = screen.getByText('995')
    expect(charCount).toBeInTheDocument()
    expect(charCount.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite')
  })
})