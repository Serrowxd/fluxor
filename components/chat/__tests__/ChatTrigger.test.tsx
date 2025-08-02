import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatTrigger } from '../ChatTrigger'

describe('ChatTrigger', () => {
  const mockOnClick = jest.fn()

  beforeEach(() => {
    mockOnClick.mockClear()
  })

  it('should render chat trigger button with correct attributes', () => {
    render(<ChatTrigger onClick={mockOnClick} />)
    
    const button = screen.getByRole('button', { name: /open chat assistant/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveClass('fixed', 'bottom-6', 'right-6')
    expect(button).toHaveAttribute('title', 'Chat with AI Assistant (Ctrl+K)')
  })

  it('should display MessageCircle icon', () => {
    render(<ChatTrigger onClick={mockOnClick} />)
    
    // Check for the icon by its parent button
    const button = screen.getByRole('button')
    const svg = button.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })

  it('should call onClick when button is clicked', async () => {
    const user = userEvent.setup()
    render(<ChatTrigger onClick={mockOnClick} />)
    
    const button = screen.getByRole('button')
    await user.click(button)
    
    expect(mockOnClick).toHaveBeenCalledTimes(1)
  })

  it('should trigger onClick on keyboard shortcut (Ctrl+K)', () => {
    render(<ChatTrigger onClick={mockOnClick} />)
    
    // Simulate Ctrl+K
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    expect(mockOnClick).toHaveBeenCalledTimes(1)
  })

  it('should trigger onClick on keyboard shortcut (Cmd+K on Mac)', () => {
    render(<ChatTrigger onClick={mockOnClick} />)
    
    // Simulate Cmd+K
    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    expect(mockOnClick).toHaveBeenCalledTimes(1)
  })

  it('should cleanup keyboard event listener on unmount', () => {
    const { unmount } = render(<ChatTrigger onClick={mockOnClick} />)
    
    unmount()
    
    // Try to trigger the keyboard shortcut after unmount
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    expect(mockOnClick).not.toHaveBeenCalled()
  })

  it('should have proper hover states', async () => {
    const user = userEvent.setup()
    render(<ChatTrigger onClick={mockOnClick} />)
    
    const button = screen.getByRole('button')
    
    // Test hover state
    await user.hover(button)
    expect(button).toHaveClass('hover:scale-105')
    
    await user.unhover(button)
  })

  it('should have proper focus states for accessibility', async () => {
    const user = userEvent.setup()
    render(<ChatTrigger onClick={mockOnClick} />)
    
    const button = screen.getByRole('button')
    
    // Test focus state
    await user.tab()
    expect(button).toHaveFocus()
    expect(button).toHaveClass('focus:outline-none', 'focus:ring-4')
  })

  it('should apply correct background color and shadow', () => {
    render(<ChatTrigger onClick={mockOnClick} />)
    
    const button = screen.getByRole('button')
    expect(button).toHaveClass('bg-blue-600', 'shadow-lg')
  })
})