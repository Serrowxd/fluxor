// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'

// Add TextEncoder/TextDecoder for Node.js environment
if (typeof global.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util');
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

// Mock scrollIntoView for tests
Element.prototype.scrollIntoView = jest.fn()

// Mock react-markdown
jest.mock('react-markdown', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: function ReactMarkdown({ children }) {
      return React.createElement('div', null, children)
    }
  }
})