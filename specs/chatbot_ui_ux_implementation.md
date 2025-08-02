# AI Chatbot UI/UX Implementation Guide

## Overview

This document outlines the user interface and user experience implementation for integrating an AI-powered chatbot into the existing Inventory Forecasting Dashboard. The design maintains consistency with the existing dark theme while making the chatbot prominent and accessible throughout the user journey.

## Design Philosophy

### Core Principles
- **Contextual Integration**: Chatbot appears contextually relevant to current dashboard content
- **Non-Intrusive Presence**: Always accessible but doesn't interfere with primary workflows
- **Conversation-Driven**: Emphasizes natural dialogue over traditional UI patterns
- **Progressive Disclosure**: Simple entry point with rich functionality revealed progressively
- **Mobile-First Responsive**: Works seamlessly across all device sizes

### Visual Language
- **Existing Theme Adherence**: Utilizes current dark theme (#1f2937, #111827)
- **AI Brand Identity**: Subtle blue accent (#3b82f6) for AI-related elements
- **Conversation Bubbles**: Modern chat interface with appropriate contrast
- **Typing Animations**: Smooth, engaging feedback for AI processing

## Component Architecture

### Primary Components

```typescript
interface ChatbotComponents {
  ChatTrigger: "Floating action button + contextual entry points";
  ChatPanel: "Expandable side panel or modal interface";
  ConversationView: "Message history with bubble design";
  InputInterface: "Message input with smart suggestions";
  ContextCards: "Visual data references within conversations";
  QuickActions: "Predefined question shortcuts";
}
```

## UI Implementation Specifications

### 1. Chat Trigger Design

#### Floating Action Button (Primary Entry)
```tsx
const ChatTrigger: React.FC = () => {
  const [hasUnread, setHasUnread] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {/* Main FAB */}
      <button
        className={cn(
          "relative flex items-center justify-center",
          "w-14 h-14 rounded-full shadow-lg",
          "bg-blue-600 hover:bg-blue-700 transition-all duration-300",
          "border border-blue-500",
          isHovered && "scale-110"
        )}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={() => toggleChat()}
      >
        {/* AI Icon */}
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
        </svg>
        
        {/* Notification Badge */}
        {hasUnread && (
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-gray-900" />
        )}
        
        {/* Pulse Animation */}
        <div className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-20" />
      </button>

      {/* Hover Tooltip */}
      {isHovered && (
        <div className="absolute bottom-16 right-0 mb-2 px-3 py-1 bg-gray-800 text-white text-sm rounded-md whitespace-nowrap">
          Ask AI about your inventory
          <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800" />
        </div>
      )}
    </div>
  );
};
```

#### Contextual Entry Points
```tsx
const ContextualChatTrigger: React.FC<{ context: string; suggestion: string }> = ({ 
  context, 
  suggestion 
}) => (
  <div className="inline-flex items-center gap-2 p-2 bg-blue-900/20 rounded-lg border border-blue-500/30">
    <div className="flex items-center gap-1 text-blue-300 text-sm">
      <MessageCircle className="w-4 h-4" />
      Ask AI:
    </div>
    <button 
      className="text-blue-100 text-sm hover:text-white transition-colors"
      onClick={() => openChatWithSuggestion(suggestion)}
    >
      "{suggestion}"
    </button>
  </div>
);

// Usage in dashboard components
const ReorderSuggestionsTable = () => (
  <div className="space-y-4">
    <div className="flex items-center justify-between">
      <h3 className="text-lg font-semibold text-white">Reorder Suggestions</h3>
      <ContextualChatTrigger 
        context="reorder-table"
        suggestion="Why should I reorder these products now?"
      />
    </div>
    {/* Table content */}
  </div>
);
```

### 2. Chat Panel Interface

#### Expandable Side Panel Design
```tsx
const ChatPanel: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ 
  isOpen, 
  onClose 
}) => {
  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}
      
      {/* Chat Panel */}
      <div className={cn(
        "fixed right-0 top-0 h-full w-full sm:w-96 bg-gray-900 border-l border-gray-700 z-50",
        "transform transition-transform duration-300 ease-in-out",
        "flex flex-col",
        isOpen ? "translate-x-0" : "translate-x-full"
      )}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
              <Brain className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-white font-semibold">Inventory AI</h3>
              <p className="text-gray-400 text-xs">Ask me anything about your inventory</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1 hover:bg-gray-800 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Conversation Area */}
        <div className="flex-1 overflow-hidden">
          <ConversationView />
        </div>

        {/* Input Area */}
        <div className="border-t border-gray-700">
          <ChatInput />
        </div>
      </div>
    </>
  );
};
```

#### Alternative Modal Design (for smaller screens)
```tsx
const ChatModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ 
  isOpen, 
  onClose 
}) => (
  <Dialog open={isOpen} onOpenChange={onClose}>
    <DialogContent className="max-w-4xl w-full h-[80vh] bg-gray-900 border-gray-700">
      <div className="flex flex-col h-full">
        <DialogHeader className="border-b border-gray-700 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <DialogTitle className="text-white">Inventory AI Assistant</DialogTitle>
              <p className="text-gray-400 text-sm">Get insights and recommendations for your inventory</p>
            </div>
          </div>
        </DialogHeader>
        
        <div className="flex-1 overflow-hidden">
          <ConversationView />
        </div>
        
        <div className="border-t border-gray-700 pt-4">
          <ChatInput />
        </div>
      </div>
    </DialogContent>
  </Dialog>
);
```

### 3. Conversation View Design

```tsx
const ConversationView: React.FC = () => {
  const { messages, isTyping } = useChat();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Welcome Message */}
      {messages.length === 0 && <WelcomeMessage />}
      
      {/* Messages */}
      {messages.map((message, index) => (
        <MessageBubble key={index} message={message} />
      ))}
      
      {/* Typing Indicator */}
      {isTyping && <TypingIndicator />}
      
      {/* Auto-scroll anchor */}
      <div ref={scrollRef} />
    </div>
  );
};

const MessageBubble: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const isUser = message.type === 'user';
  
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn(
        "max-w-[80%] rounded-2xl px-4 py-3",
        isUser 
          ? "bg-blue-600 text-white" 
          : "bg-gray-800 text-gray-100 border border-gray-700"
      )}>
        {!isUser && (
          <div className="flex items-center gap-2 mb-2">
            <Brain className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-blue-400 font-medium">Inventory AI</span>
          </div>
        )}
        
        <div className={cn(
          "text-sm leading-relaxed",
          isUser ? "text-white" : "text-gray-100"
        )}>
          {message.content}
        </div>
        
        {/* Confidence Score for AI messages */}
        {!isUser && message.confidence && (
          <div className="flex items-center gap-1 mt-2 pt-2 border-t border-gray-700">
            <div className="text-xs text-gray-400">
              Confidence: {message.confidence}%
            </div>
            <div className={cn(
              "w-2 h-2 rounded-full",
              message.confidence > 80 ? "bg-green-400" :
              message.confidence > 60 ? "bg-yellow-400" : "bg-red-400"
            )} />
          </div>
        )}
        
        {/* Timestamp */}
        <div className={cn(
          "text-xs mt-1",
          isUser ? "text-blue-200" : "text-gray-500"
        )}>
          {formatTime(message.timestamp)}
        </div>
      </div>
    </div>
  );
};

const TypingIndicator: React.FC = () => (
  <div className="flex justify-start">
    <div className="bg-gray-800 border border-gray-700 rounded-2xl px-4 py-3 max-w-[80%]">
      <div className="flex items-center gap-2 mb-2">
        <Brain className="w-4 h-4 text-blue-400" />
        <span className="text-xs text-blue-400 font-medium">Inventory AI</span>
      </div>
      <div className="flex items-center gap-1">
        <div className="flex space-x-1">
          <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
          <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
          <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></div>
        </div>
        <span className="text-xs text-gray-400 ml-2">Analyzing your data...</span>
      </div>
    </div>
  </div>
);

const WelcomeMessage: React.FC = () => (
  <div className="text-center py-8">
    <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
      <Brain className="w-8 h-8 text-white" />
    </div>
    <h3 className="text-white text-lg font-semibold mb-2">Welcome to Inventory AI</h3>
    <p className="text-gray-400 text-sm mb-6 max-w-xs mx-auto">
      I can help you understand your inventory data, make reorder decisions, and spot trends.
    </p>
    <QuickActionsSuggestions />
  </div>
);
```

### 4. Input Interface Design

```tsx
const ChatInput: React.FC = () => {
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { sendMessage } = useChat();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await sendMessage(message);
      setMessage('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-4">
      {/* Quick Suggestions */}
      <QuickSuggestions onSuggestionClick={setMessage} />
      
      {/* Input Area */}
      <div className="relative">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ask me about your inventory..."
          className={cn(
            "w-full rounded-xl border border-gray-700 bg-gray-800",
            "text-white placeholder-gray-400",
            "px-4 py-3 pr-12 resize-none",
            "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent",
            "min-h-[44px] max-h-32"
          )}
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        />
        
        {/* Send Button */}
        <button
          type="submit"
          disabled={!message.trim() || isSubmitting}
          className={cn(
            "absolute right-2 bottom-2 p-2 rounded-lg transition-colors",
            message.trim() && !isSubmitting
              ? "bg-blue-600 hover:bg-blue-700 text-white"
              : "bg-gray-700 text-gray-400 cursor-not-allowed"
          )}
        >
          {isSubmitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </button>
      </div>
      
      {/* Character Counter */}
      <div className="flex justify-between items-center mt-2 text-xs text-gray-500">
        <span>Press Enter to send, Shift+Enter for new line</span>
        <span>{message.length}/1000</span>
      </div>
    </form>
  );
};

const QuickSuggestions: React.FC<{ onSuggestionClick: (msg: string) => void }> = ({ 
  onSuggestionClick 
}) => {
  const suggestions = [
    "Should I reorder winter coats?",
    "What are my best selling products?",
    "Why is my forecast showing high demand?",
    "Which products are overstocked?"
  ];

  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {suggestions.map((suggestion, index) => (
        <button
          key={index}
          onClick={() => onSuggestionClick(suggestion)}
          className={cn(
            "px-3 py-1 rounded-full text-xs",
            "bg-gray-800 border border-gray-600 text-gray-300",
            "hover:bg-gray-700 hover:text-white transition-colors"
          )}
        >
          {suggestion}
        </button>
      ))}
    </div>
  );
};
```

### 5. Context Cards Integration

```tsx
const ContextCard: React.FC<{ data: any; type: string }> = ({ data, type }) => {
  return (
    <div className="my-3 p-3 bg-gray-800/50 border border-gray-700 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <BarChart3 className="w-4 h-4 text-blue-400" />
        <span className="text-xs font-medium text-blue-400">Data Reference</span>
      </div>
      
      {type === 'product' && (
        <div className="space-y-1">
          <div className="text-sm text-white font-medium">{data.name}</div>
          <div className="text-xs text-gray-400">
            Current Stock: {data.currentStock} | Predicted: {data.predicted}
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div 
              className="bg-blue-500 h-2 rounded-full"
              style={{ width: `${(data.currentStock / data.predicted) * 100}%` }}
            />
          </div>
        </div>
      )}
      
      {type === 'forecast' && (
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <div className="text-gray-400">Next 30 days</div>
            <div className="text-white font-medium">{data.forecast30} units</div>
          </div>
          <div>
            <div className="text-gray-400">Confidence</div>
            <div className="text-white font-medium">{data.confidence}%</div>
          </div>
        </div>
      )}
    </div>
  );
};
```

## Responsive Design Implementation

### Mobile Optimization
```tsx
const ResponsiveChatInterface: React.FC = () => {
  const [isMobile] = useMediaQuery('(max-width: 768px)');
  
  return (
    <>
      {isMobile ? (
        // Full-screen mobile interface
        <ChatModal />
      ) : (
        // Desktop side panel
        <ChatPanel />
      )}
    </>
  );
};
```

### Tablet and Desktop Considerations
```css
/* Desktop: Side panel approach */
@media (min-width: 1024px) {
  .chat-panel {
    position: fixed;
    right: 0;
    top: 0;
    height: 100vh;
    width: 400px;
    transform: translateX(100%);
    transition: transform 0.3s ease-in-out;
  }
  
  .chat-panel.open {
    transform: translateX(0);
  }
  
  /* Adjust main content when chat is open */
  .main-content.chat-open {
    margin-right: 400px;
    transition: margin-right 0.3s ease-in-out;
  }
}

/* Tablet: Modal approach */
@media (min-width: 768px) and (max-width: 1023px) {
  .chat-modal {
    width: 90vw;
    max-width: 600px;
    height: 80vh;
  }
}

/* Mobile: Full screen */
@media (max-width: 767px) {
  .chat-mobile {
    position: fixed;
    inset: 0;
    z-index: 50;
  }
}
```

## Integration with Existing Dashboard Components

### 6. Dashboard Integration Points

```tsx
// Enhanced dashboard components with chat integration
const DashboardWithChat: React.FC = () => {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatContext, setChatContext] = useState<string | null>(null);

  return (
    <div className={cn("min-h-screen bg-gray-900", chatOpen && "lg:mr-96")}>
      {/* Existing Dashboard Layout */}
      <div className="transition-all duration-300">
        <DashboardHeader />
        <DashboardContent />
      </div>

      {/* Chat Integration */}
      <ChatTrigger onClick={() => setChatOpen(true)} />
      <ChatPanel 
        isOpen={chatOpen} 
        onClose={() => setChatOpen(false)}
        initialContext={chatContext}
      />
    </div>
  );
};

// Enhanced chart components with chat triggers
const SalesTrendsChart: React.FC = () => {
  const { openChatWithContext } = useChat();

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Sales Trends</h3>
        <button
          onClick={() => openChatWithContext('Explain my sales trends', { chartType: 'sales' })}
          className="flex items-center gap-2 px-3 py-1 bg-blue-900/30 hover:bg-blue-900/50 rounded-md transition-colors"
        >
          <MessageCircle className="w-4 h-4 text-blue-400" />
          <span className="text-sm text-blue-300">Ask AI</span>
        </button>
      </div>
      
      {/* Chart Component */}
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={salesData}>
          {/* Chart implementation */}
        </LineChart>
      </ResponsiveContainer>
      
      {/* Contextual suggestions */}
      <div className="mt-4 flex flex-wrap gap-2">
        <ChatSuggestionChip 
          text="Why did sales spike in week 3?"
          context={{ chartType: 'sales', timeframe: 'week3' }}
        />
        <ChatSuggestionChip 
          text="What's driving the upward trend?"
          context={{ chartType: 'sales', trend: 'upward' }}
        />
      </div>
    </div>
  );
};

const InventoryLevelsChart: React.FC = () => {
  const { openChatWithContext } = useChat();

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Inventory Levels</h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 px-3 py-1 bg-blue-900/30 hover:bg-blue-900/50 rounded-md transition-colors">
              <MessageCircle className="w-4 h-4 text-blue-400" />
              <span className="text-sm text-blue-300">Ask AI</span>
              <ChevronDown className="w-3 h-3 text-blue-400" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="bg-gray-800 border-gray-700">
            <DropdownMenuItem onClick={() => openChatWithContext('Which products are running low?')}>
              Which products are running low?
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openChatWithContext('What should I reorder this week?')}>
              What should I reorder this week?
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openChatWithContext('Explain my inventory distribution')}>
              Explain my inventory distribution
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      
      {/* Bar Chart */}
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={inventoryData}>
          {/* Chart implementation */}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
```

### 7. Enhanced Reorder Table with AI Integration

```tsx
const ReorderSuggestionsTable: React.FC = () => {
  const { openChatWithContext } = useChat();
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700">
      <div className="p-6 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Reorder Suggestions</h3>
          <div className="flex items-center gap-3">
            {selectedProducts.length > 0 && (
              <button
                onClick={() => openChatWithContext(
                  `Should I reorder these ${selectedProducts.length} selected products?`,
                  { productIds: selectedProducts }
                )}
                className="flex items-center gap-2 px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                <span className="text-sm">Ask AI about selected</span>
              </button>
            )}
            <button
              onClick={() => openChatWithContext('Explain these reorder recommendations')}
              className="flex items-center gap-2 px-3 py-1 bg-blue-900/30 hover:bg-blue-900/50 rounded-md transition-colors"
            >
              <Brain className="w-4 h-4 text-blue-400" />
              <span className="text-sm text-blue-300">Explain All</span>
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-700/50">
            <tr>
              <th className="px-6 py-3 text-left">
                <Checkbox 
                  checked={selectedProducts.length === reorderData.length}
                  onCheckedChange={handleSelectAll}
                />
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                Product
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                Current Stock
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                Suggested Order
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                Priority
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {reorderData.map((item) => (
              <tr key={item.id} className="hover:bg-gray-700/30 transition-colors">
                <td className="px-6 py-4">
                  <Checkbox 
                    checked={selectedProducts.includes(item.id)}
                    onCheckedChange={(checked) => handleProductSelect(item.id, checked)}
                  />
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <img 
                      src={item.image} 
                      alt={item.name}
                      className="w-10 h-10 rounded-lg object-cover"
                    />
                    <div>
                      <div className="text-sm font-medium text-white">{item.name}</div>
                      <div className="text-xs text-gray-400">{item.sku}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-white">{item.currentStock}</div>
                  <div className="text-xs text-gray-400">units in stock</div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-white font-medium">{item.suggestedOrder}</div>
                  <div className="text-xs text-gray-400">recommended</div>
                </td>
                <td className="px-6 py-4">
                  <UrgencyBadge urgency={item.urgency} />
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSingleReorder(item.id)}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-md transition-colors"
                    >
                      Reorder
                    </button>
                    <button
                      onClick={() => openChatWithContext(
                        `Why should I reorder ${item.name}?`,
                        { productId: item.id }
                      )}
                      className="p-1 text-gray-400 hover:text-blue-400 transition-colors"
                      title="Ask AI about this product"
                    >
                      <MessageCircle className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const UrgencyBadge: React.FC<{ urgency: 'high' | 'medium' | 'low' }> = ({ urgency }) => {
  const variants = {
    high: "bg-red-900/30 text-red-300 border-red-500/30",
    medium: "bg-yellow-900/30 text-yellow-300 border-yellow-500/30",
    low: "bg-green-900/30 text-green-300 border-green-500/30"
  };

  return (
    <span className={cn(
      "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border",
      variants[urgency]
    )}>
      {urgency.charAt(0).toUpperCase() + urgency.slice(1)}
    </span>
  );
};
```

### 8. Quick Actions and Suggestions

```tsx
const QuickActionsSuggestions: React.FC = () => {
  const { openChatWithContext } = useChat();
  
  const quickActions = [
    {
      icon: TrendingUp,
      label: "Sales Analysis",
      suggestion: "What are my sales trends this month?",
      category: "analytics"
    },
    {
      icon: Package,
      label: "Stock Check",
      suggestion: "Which products are running low?",
      category: "inventory"
    },
    {
      icon: ShoppingCart,
      label: "Reorder Help",
      suggestion: "What should I reorder this week?",
      category: "purchasing"
    },
    {
      icon: Calendar,
      label: "Seasonal Insights",
      suggestion: "How should I prepare for the holiday season?",
      category: "planning"
    }
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {quickActions.map((action, index) => (
        <button
          key={index}
          onClick={() => openChatWithContext(action.suggestion)}
          className="flex flex-col items-center gap-2 p-3 bg-gray-800/50 hover:bg-gray-700/50 rounded-lg border border-gray-700 transition-colors"
        >
          <action.icon className="w-5 h-5 text-blue-400" />
          <span className="text-xs text-gray-300 text-center">{action.label}</span>
        </button>
      ))}
    </div>
  );
};

const ChatSuggestionChip: React.FC<{ 
  text: string; 
  context?: Record<string, any> 
}> = ({ text, context }) => {
  const { openChatWithContext } = useChat();

  return (
    <button
      onClick={() => openChatWithContext(text, context)}
      className="inline-flex items-center gap-1 px-2 py-1 bg-blue-900/20 hover:bg-blue-900/40 text-blue-300 text-xs rounded-md transition-colors border border-blue-500/30"
    >
      <MessageCircle className="w-3 h-3" />
      {text}
    </button>
  );
};
```

### 9. Advanced Chat Features

```tsx
// Conversation History Sidebar
const ConversationHistory: React.FC = () => {
  const { conversations, currentConversation, switchConversation } = useChat();

  return (
    <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <h3 className="text-white font-semibold">Chat History</h3>
        <button 
          onClick={() => startNewConversation()}
          className="mt-2 w-full px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-md transition-colors"
        >
          New Conversation
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {conversations.map((conversation) => (
          <div
            key={conversation.id}
            onClick={() => switchConversation(conversation.id)}
            className={cn(
              "p-3 border-b border-gray-700 cursor-pointer transition-colors",
              "hover:bg-gray-700/50",
              currentConversation?.id === conversation.id && "bg-blue-900/30"
            )}
          >
            <div className="text-sm text-white font-medium truncate">
              {conversation.title}
            </div>
            <div className="text-xs text-gray-400 truncate mt-1">
              {conversation.lastMessage}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {formatRelativeTime(conversation.updatedAt)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Message Actions (copy, share, etc.)
const MessageActions: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div 
      className="relative"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {isVisible && (
        <div className="absolute top-0 right-0 flex items-center gap-1 bg-gray-700 rounded-md p-1">
          <button
            onClick={() => copyToClipboard(message.content)}
            className="p-1 hover:bg-gray-600 rounded text-gray-300 hover:text-white transition-colors"
            title="Copy message"
          >
            <Copy className="w-3 h-3" />
          </button>
          <button
            onClick={() => shareMessage(message)}
            className="p-1 hover:bg-gray-600 rounded text-gray-300 hover:text-white transition-colors"
            title="Share message"
          >
            <Share className="w-3 h-3" />
          </button>
          {!message.isUser && (
            <button
              onClick={() => provideFeedback(message.id)}
              className="p-1 hover:bg-gray-600 rounded text-gray-300 hover:text-white transition-colors"
              title="Provide feedback"
            >
              <ThumbsUp className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
```

### 10. Mobile-Specific Optimizations

```tsx
// Mobile Chat Interface
const MobileChatInterface: React.FC = () => {
  const [isFullscreen, setIsFullscreen] = useState(false);

  return (
    <div className="lg:hidden">
      {/* Mobile FAB */}
      <button
        onClick={() => setIsFullscreen(true)}
        className="fixed bottom-4 right-4 w-12 h-12 bg-blue-600 rounded-full shadow-lg flex items-center justify-center z-50"
      >
        <MessageCircle className="w-6 h-6 text-white" />
      </button>

      {/* Fullscreen Mobile Chat */}
      {isFullscreen && (
        <div className="fixed inset-0 bg-gray-900 z-50 flex flex-col">
          {/* Mobile Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-700">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                <Brain className="w-4 h-4 text-white" />
              </div>
              <h3 className="text-white font-semibold">Inventory AI</h3>
            </div>
            <button
              onClick={() => setIsFullscreen(false)}
              className="p-2 hover:bg-gray-800 rounded-full transition-colors"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          {/* Mobile Conversation */}
          <div className="flex-1 overflow-hidden">
            <ConversationView />
          </div>

          {/* Mobile Input */}
          <div className="border-t border-gray-700 bg-gray-900">
            <MobileChatInput />
          </div>
        </div>
      )}
    </div>
  );
};

const MobileChatInput: React.FC = () => {
  const [message, setMessage] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(true);

  return (
    <div className="p-4">
      {/* Mobile Quick Suggestions */}
      {showSuggestions && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">Quick questions:</span>
            <button
              onClick={() => setShowSuggestions(false)}
              className="text-xs text-gray-500"
            >
              Hide
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {['Stock check', 'Reorder help', 'Sales trends', 'Seasonal prep'].map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => setMessage(getFullSuggestion(suggestion))}
                className="px-3 py-1 bg-gray-800 border border-gray-600 text-gray-300 text-sm rounded-full"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mobile Input Field */}
      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Ask about your inventory..."
            className="w-full rounded-xl border border-gray-700 bg-gray-800 text-white placeholder-gray-400 px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={1}
            style={{ minHeight: '44px', maxHeight: '120px' }}
          />
        </div>
        <button
          disabled={!message.trim()}
          className={cn(
            "p-3 rounded-xl transition-colors",
            message.trim()
              ? "bg-blue-600 hover:bg-blue-700 text-white"
              : "bg-gray-700 text-gray-400"
          )}
        >
          <Send className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
```

## Performance and Accessibility

### Performance Optimizations
```tsx
// Virtualized message list for large conversations
const VirtualizedConversation: React.FC = () => {
  const { messages } = useChat();
  
  return (
    <FixedSizeList
      height={400}
      itemCount={messages.length}
      itemSize={120}
      className="overflow-auto"
    >
      {({ index, style }) => (
        <div style={style}>
          <MessageBubble message={messages[index]} />
        </div>
      )}
    </FixedSizeList>
  );
};

// Lazy loading for chat history
const LazyConversationHistory = lazy(() => import('./ConversationHistory'));

// Memoized components to prevent unnecessary re-renders
const MemoizedMessageBubble = memo(MessageBubble);
const MemoizedContextCard = memo(ContextCard);
```

### Accessibility Features
```tsx
// Screen reader announcements
const useAnnouncements = () => {
  const announce = (message: string) => {
    const announcement = document.createElement('div');
    announcement.setAttribute('aria-live', 'polite');
    announcement.setAttribute('aria-atomic', 'true');
    announcement.className = 'sr-only';
    announcement.textContent = message;
    document.body.appendChild(announcement);
    
    setTimeout(() => document.body.removeChild(announcement), 1000);
  };

  return { announce };
};

// Keyboard navigation support
const useKeyboardNavigation = () => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeChatPanel();
      }
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        openChatPanel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
};

// Focus management
const ChatPanel: React.FC = () => {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  return (
    <div role="dialog" aria-labelledby="chat-title" aria-modal="true">
      <h2 id="chat-title" className="sr-only">Inventory AI Chat</h2>
      {/* Chat content */}
      <textarea
        ref={inputRef}
        aria-label="Type your message to Inventory AI"
        // ...other props
      />
    </div>
  );
};
```

## Animation and Micro-interactions

```tsx
// Smooth transitions and animations
const AnimatedChatPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <motion.div
      initial={false}
      animate={{
        x: isOpen ? 0 : '100%',
        opacity: isOpen ? 1 : 0
      }}
      transition={{
        type: 'spring',
        stiffness: 300,
        damping: 30
      }}
      className="fixed right-0 top-0 h-full w-96 bg-gray-900 border-l border-gray-700 z-50"
    >
      {/* Panel content */}
    </motion.div>
  );
};

// Message entrance animations
const AnimatedMessage: React.FC<{ message: ChatMessage }> = ({ message }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <MessageBubble message={message} />
    </motion.div>
  );
};

// Typing indicator animation
const AnimatedTypingIndicator: React.FC = () => {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ duration: 0.2 }}
    >
      <TypingIndicator />
    </motion.div>
  );
};
```

## Integration with Chat Hooks

```tsx
// Main chat hook for state management
export const useChat = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [currentConversation, setCurrentConversation] = useState<string | null>(null);

  const sendMessage = async (content: string, context?: any) => {
    // Add user message immediately
    const userMessage: ChatMessage = {
      id: generateId(),
      content,
      type: 'user',
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);

    // Show typing indicator
    setIsTyping(true);

    try {
      const response = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          conversationId: currentConversation,
          context
        })
      });

      const data = await response.json();

      // Add AI response
      const aiMessage: ChatMessage = {
        id: generateId(),
        content: data.message,
        type: 'assistant',
        timestamp: new Date(),
        confidence: data.confidence,
        metadata: data.metadata
      };
      setMessages(prev => [...prev, aiMessage]);

      // Update conversation ID if new
      if (data.conversationId && !currentConversation) {
        setCurrentConversation(data.conversationId);
      }

    } catch (error) {
      console.error('Error sending message:', error);
      // Handle error...
    } finally {
      setIsTyping(false);
    }
  };

  const openChatWithContext = (message: string, context?: any) => {
    setIsOpen(true);
    if (message) {
      sendMessage(message, context);
    }
  };

  return {
    isOpen,
    setIsOpen,
    messages,
    isTyping,
    sendMessage,
    openChatWithContext,
    currentConversation
  };
};
```

This comprehensive UI/UX implementation guide provides everything needed to create a polished, accessible, and engaging chatbot interface that seamlessly integrates with your existing inventory management dashboard while maintaining design consistency and providing excellent user experience across all devices.