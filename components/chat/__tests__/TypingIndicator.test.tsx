import React from 'react'
import { render, screen } from '@testing-library/react'
import { TypingIndicator } from '../TypingIndicator'

describe('TypingIndicator', () => {
  it('should render three bouncing dots', () => {
    render(<TypingIndicator />)
    
    const dots = screen.getByRole('status').querySelectorAll('.animate-bounce')
    expect(dots).toHaveLength(3)
  })

  it('should display default label', () => {
    render(<TypingIndicator />)
    
    // Check for visible label (not sr-only)
    const visibleLabel = screen.getByText('AI is typing', { selector: ':not(.sr-only)' })
    expect(visibleLabel).toBeInTheDocument()
  })

  it('should display custom label when provided', () => {
    render(<TypingIndicator label="Assistant is thinking..." />)
    
    const visibleLabel = screen.getByText('Assistant is thinking...', { selector: ':not(.sr-only)' })
    expect(visibleLabel).toBeInTheDocument()
    expect(screen.queryByText('AI is typing')).not.toBeInTheDocument()
  })

  it('should not display label when label is empty string', () => {
    render(<TypingIndicator label="" />)
    
    expect(screen.queryByText('AI is typing')).not.toBeInTheDocument()
  })

  it('should have correct animation delays on dots', () => {
    render(<TypingIndicator />)
    
    const dots = screen.getByRole('status').querySelectorAll('.rounded-full')
    
    expect(dots[0]).toHaveClass('[animation-delay:-0.3s]')
    expect(dots[1]).toHaveClass('[animation-delay:-0.15s]')
    expect(dots[2]).not.toHaveClass('[animation-delay:-0.3s]')
    expect(dots[2]).not.toHaveClass('[animation-delay:-0.15s]')
  })

  it('should apply custom className', () => {
    render(<TypingIndicator className="custom-class" />)
    
    const container = screen.getByRole('status')
    expect(container).toHaveClass('custom-class')
    expect(container).toHaveClass('flex', 'items-center', 'gap-2')
  })

  it('should have proper ARIA attributes for accessibility', () => {
    render(<TypingIndicator />)
    
    const indicator = screen.getByRole('status')
    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveAttribute('aria-label', 'AI is typing')
  })

  it('should use custom label for aria-label', () => {
    render(<TypingIndicator label="Processing your request" />)
    
    const indicator = screen.getByRole('status')
    expect(indicator).toHaveAttribute('aria-label', 'Processing your request')
  })

  it('should have screen reader text', () => {
    render(<TypingIndicator />)
    
    const srText = screen.getByText('AI is typing', { selector: '.sr-only' })
    expect(srText).toBeInTheDocument()
    expect(srText).toHaveClass('sr-only')
  })

  it('should render dots with correct styling', () => {
    render(<TypingIndicator />)
    
    const dots = screen.getByRole('status').querySelectorAll('.rounded-full')
    
    dots.forEach(dot => {
      expect(dot).toHaveClass('w-2', 'h-2', 'bg-gray-400', 'rounded-full', 'animate-bounce')
    })
  })

  it('should maintain text color for label', () => {
    render(<TypingIndicator />)
    
    const label = screen.getByText('AI is typing', { selector: ':not(.sr-only)' })
    expect(label).toHaveClass('text-sm')
    expect(label.parentElement).toHaveClass('text-gray-400')
  })
})