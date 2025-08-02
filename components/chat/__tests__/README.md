# Chat Component Tests

This directory contains comprehensive test coverage for all chat UI components.

## Test Structure

### Unit Tests
- `ChatTrigger.test.tsx` - Tests for the floating action button
- `ChatPanel.test.tsx` - Tests for the slide-in panel component
- `MessageBubble.test.tsx` - Tests for individual message display
- `ConversationView.test.tsx` - Tests for the conversation container
- `ChatInput.test.tsx` - Tests for the message input component
- `TypingIndicator.test.tsx` - Tests for the typing animation

### Integration Tests
- `ChatIntegration.test.tsx` - End-to-end chat flow testing

### Hook Tests
- `/hooks/__tests__/useChat.test.tsx` - State management and API integration

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage

# Run specific test file
pnpm test ChatTrigger.test.tsx
```

## Test Coverage

All components are tested for:
- ✅ Rendering and visual behavior
- ✅ User interactions (click, type, keyboard)
- ✅ Accessibility (ARIA, keyboard nav, screen readers)
- ✅ Edge cases and error handling
- ✅ Performance with large datasets
- ✅ Integration between components

## Key Testing Patterns

### Accessibility Testing
```typescript
expect(element).toHaveAttribute('aria-label', 'descriptive label')
expect(element).toHaveRole('button')
expect(element).toHaveFocus()
```

### User Interaction Testing
```typescript
const user = userEvent.setup()
await user.click(button)
await user.type(input, 'text')
await user.keyboard('{Enter}')
```

### Async Testing
```typescript
await waitFor(() => {
  expect(element).toBeInTheDocument()
})
```

## Mocking Strategies

### API Calls
```typescript
global.fetch = jest.fn()
fetch.mockResolvedValueOnce({
  ok: true,
  json: async () => mockData
})
```

### EventSource (SSE)
```typescript
const mockEventSource = {
  close: jest.fn(),
  addEventListener: jest.fn()
}
global.EventSource = jest.fn(() => mockEventSource)
```

### Custom Hooks
```typescript
jest.mock('@/hooks/useChat')
```

## Common Test Scenarios

1. **Component Rendering** - Verify elements appear correctly
2. **State Changes** - Test UI updates based on state
3. **Error Handling** - Ensure graceful error recovery
4. **Loading States** - Verify loading indicators
5. **Empty States** - Test behavior with no data
6. **Edge Cases** - Long text, special characters, limits

## Debugging Tips

- Use `screen.debug()` to see the current DOM
- Use `screen.logTestingPlaygroundURL()` for interactive debugging
- Check for async issues with `waitFor` and `findBy` queries
- Verify mock implementations are correct

## Future Improvements

- [ ] Add visual regression testing
- [ ] Implement E2E tests with Playwright/Cypress
- [ ] Add performance benchmarks
- [ ] Increase coverage to 100%