"use client";

import { useState } from "react";
import { ChatTrigger } from "@/components/chat/ChatTrigger";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ConversationView, Message } from "@/components/chat/ConversationView";
import { ChatInput } from "@/components/chat/ChatInput";

export default function ChatDemoPage() {
  const [isOpen, setIsOpen] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // Demo messages
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hello! I\'m your AI inventory assistant. How can I help you today?',
      timestamp: new Date(Date.now() - 5 * 60 * 1000) // 5 minutes ago
    },
    {
      id: '2',
      role: 'user',
      content: 'What are my low stock items?',
      timestamp: new Date(Date.now() - 4 * 60 * 1000) // 4 minutes ago
    },
    {
      id: '3',
      role: 'assistant',
      content: 'Based on your current inventory levels, I found 3 items that are running low:\n\n1. **Widget Pro Max** - Only 5 units left (usually stock 50)\n2. **Smart Sensor v2** - 8 units remaining (reorder point: 10)\n3. **Power Cable Set** - 12 units left (high demand this week)\n\nWould you like me to create reorder suggestions for these items?',
      timestamp: new Date(Date.now() - 3 * 60 * 1000) // 3 minutes ago
    }
  ]);

  // Simulate typing indicator
  const simulateTyping = () => {
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: 'I\'ve analyzed your seasonal patterns. Based on last year\'s data, you typically see a 40% increase in demand for these items during the holiday season. I recommend ordering 150% of your usual quantity to avoid stockouts.',
        timestamp: new Date()
      }]);
    }, 3000);
  };

  // Handle sending messages
  const handleSendMessage = (message: string) => {
    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: message,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMessage]);

    // Simulate AI response
    setIsSending(true);
    setIsTyping(true);
    
    setTimeout(() => {
      setIsSending(false);
      setIsTyping(false);
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `I understand you're asking about "${message}". Let me analyze your inventory data to provide you with the most relevant information...`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiMessage]);
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-gray-900 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-4">Chat Demo</h1>
        <p className="text-gray-400 mb-8">
          Click the chat button in the bottom right corner or press Ctrl+K (Cmd+K on Mac) to open the chat.
        </p>
        
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg mb-8">
          <h2 className="text-xl font-semibold text-white mb-2">Input Components Features</h2>
          <ul className="text-gray-400 space-y-2">
            <li>✓ Text input with send button</li>
            <li>✓ 1000 character limit with counter</li>
            <li>✓ Character count warning when approaching limit</li>
            <li>✓ Enter key to send messages</li>
            <li>✓ Disabled state while sending</li>
            <li>✓ Clear input after sending</li>
            <li>✓ Animated typing indicator</li>
            <li>✓ Accessible with ARIA labels</li>
          </ul>
        </div>

        <div className="bg-gray-800 p-6 rounded-lg shadow-lg mb-8">
          <h2 className="text-xl font-semibold text-white mb-2">Test Instructions</h2>
          <p className="text-gray-400">
            The chat panel now includes input components. You can:
          </p>
          <ul className="text-gray-400 mt-2 space-y-1">
            <li>• Type a message and click send or press Enter</li>
            <li>• Watch the character counter as you type</li>
            <li>• See the typing indicator when AI responds</li>
            <li>• Try typing more than 900 characters to see the warning</li>
            <li>• Notice the input is disabled while sending</li>
          </ul>
        </div>

        <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
          <h2 className="text-xl font-semibold text-white mb-2">Interactive Demo</h2>
          <p className="text-gray-400 mb-4">
            Test the typing indicator and message animations:
          </p>
          <button
            onClick={simulateTyping}
            disabled={isTyping}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isTyping ? 'AI is typing...' : 'Simulate AI Response'}
          </button>
        </div>
      </div>

      <ChatTrigger onClick={() => setIsOpen(true)} />
      <ChatPanel 
        isOpen={isOpen} 
        onOpenChange={setIsOpen}
        inputComponent={
          <ChatInput 
            onSendMessage={handleSendMessage}
            disabled={isSending}
            placeholder="Ask about inventory, forecasts, or trends..."
          />
        }
      >
        <ConversationView 
          messages={messages} 
          isTyping={isTyping}
          className="h-full"
        />
      </ChatPanel>
    </div>
  );
}