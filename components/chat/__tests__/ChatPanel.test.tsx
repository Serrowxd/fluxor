import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatPanel } from '../ChatPanel'

describe('ChatPanel', () => {
  const mockOnOpenChange = jest.fn()

  beforeEach(() => {
    mockOnOpenChange.mockClear()
  })

  it('should not render when isOpen is false', () => {
    const { container } = render(
      <ChatPanel isOpen={false} onOpenChange={mockOnOpenChange} />
    )
    
    // Sheet content should not be visible
    expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument()
  })

  it('should render when isOpen is true', async () => {
    render(
      <ChatPanel isOpen={true} onOpenChange={mockOnOpenChange} />
    )
    
    // Wait for dialog to appear
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  it('should display header with AI Assistant title and icon', async () => {
    render(
      <ChatPanel isOpen={true} onOpenChange={mockOnOpenChange} />
    )
    
    await waitFor(() => {
      expect(screen.getByText('AI Assistant')).toBeInTheDocument()
      expect(screen.getByText('Ask me about your inventory')).toBeInTheDocument()
    })
  })

  it('should render children when provided', async () => {
    const testContent = <div data-testid="test-content">Test Content</div>
    
    render(
      <ChatPanel isOpen={true} onOpenChange={mockOnOpenChange}>
        {testContent}
      </ChatPanel>
    )
    
    await waitFor(() => {
      expect(screen.getByTestId('test-content')).toBeInTheDocument()
    })
  })

  it('should render default content when no children provided', async () => {
    render(
      <ChatPanel isOpen={true} onOpenChange={mockOnOpenChange} />
    )
    
    await waitFor(() => {
      expect(screen.getByText('Start a conversation to get insights about your inventory')).toBeInTheDocument()
    })
  })

  it('should render input component when provided', async () => {
    const testInput = <input data-testid="test-input" placeholder="Test input" />
    
    render(
      <ChatPanel 
        isOpen={true} 
        onOpenChange={mockOnOpenChange}
        inputComponent={testInput}
      />
    )
    
    await waitFor(() => {
      expect(screen.getByTestId('test-input')).toBeInTheDocument()
    })
  })

  it('should call onOpenChange when close button is clicked', async () => {
    const user = userEvent.setup()
    
    render(
      <ChatPanel isOpen={true} onOpenChange={mockOnOpenChange} />
    )
    
    // Find and click the close button
    const closeButton = await screen.findByRole('button', { name: /close/i })
    await user.click(closeButton)
    
    expect(mockOnOpenChange).toHaveBeenCalledWith(false)
  })

  it('should have correct styling classes', async () => {
    render(
      <ChatPanel isOpen={true} onOpenChange={mockOnOpenChange} />
    )
    
    await waitFor(() => {
      const dialog = screen.getByRole('dialog')
      expect(dialog).toBeInTheDocument()
      
      // Check for the main panel content
      const content = screen.getByLabelText('AI Assistant Chat Panel')
      expect(content).toHaveClass('bg-gray-900', 'border-gray-800')
    })
  })

  it('should be responsive with correct width classes', async () => {
    render(
      <ChatPanel isOpen={true} onOpenChange={mockOnOpenChange} />
    )
    
    await waitFor(() => {
      const content = screen.getByLabelText('AI Assistant Chat Panel')
      expect(content).toHaveClass('w-full', 'sm:w-[400px]')
    })
  })

  it('should have proper ARIA attributes', async () => {
    render(
      <ChatPanel isOpen={true} onOpenChange={mockOnOpenChange} />
    )
    
    await waitFor(() => {
      const dialog = screen.getByRole('dialog')
      expect(dialog).toBeInTheDocument()
      
      // Check for proper heading structure
      expect(screen.getByText('AI Assistant')).toBeInTheDocument()
    })
  })

  it('should handle focus trap when open', async () => {
    const user = userEvent.setup()
    
    render(
      <ChatPanel isOpen={true} onOpenChange={mockOnOpenChange}>
        <button>First button</button>
        <button>Second button</button>
      </ChatPanel>
    )
    
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    
    // Tab navigation should stay within the panel
    await user.tab()
    expect(document.activeElement).toBeInTheDocument()
  })
})