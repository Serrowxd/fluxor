# ChatContextBuilder Service

## Overview
The ChatContextBuilder service is responsible for aggregating data from various sources (inventory, forecasts, events) to provide context for AI-powered chat responses in the Fluxor system.

## Key Features
- **Parallel Data Fetching**: Aggregates data from multiple services in parallel for optimal performance
- **Intelligent Filtering**: Filters relevant data based on user queries using keyword extraction
- **Redis Caching**: Caches context data for improved response times
- **Error Resilience**: Handles service failures gracefully with fallback data

## Methods

### `buildContext(userId, storeId, userMessage)`
Main method that builds comprehensive chat context by aggregating data from multiple sources.

**Parameters:**
- `userId` (string): User ID
- `storeId` (string): Store ID  
- `userMessage` (string): User's message to help filter relevant data

**Returns:** Promise<Object> containing:
- `user`: User profile information
- `store`: Store information
- `inventory`: Inventory snapshot with low stock and reorder suggestions
- `forecasts`: Active forecasts with confidence scores
- `seasonalPatterns`: Identified seasonal patterns
- `recentEvents`: Recent business events (stockouts, etc.)
- `salesTrends`: Sales trend analysis
- `dashboardMetrics`: Summary dashboard metrics
- `timestamp`: Context creation timestamp

### `filterRelevantData(data, userMessage)`
Filters data based on relevance to user message using keyword extraction.

### `extractKeywords(message)`
Extracts meaningful keywords from user message, filtering out stop words.

## Integration Example

```javascript
const ChatContextBuilder = require('./chatContextBuilder');

// In your chat controller
async function handleChatMessage(req, res) {
  const contextBuilder = new ChatContextBuilder();
  const { userId, storeId } = req.user;
  const { message } = req.body;
  
  try {
    // Build context
    const context = await contextBuilder.buildContext(userId, storeId, message);
    
    // Use context for AI response generation
    // ... pass to prompt engineering service
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process request' });
  }
}
```

## Performance Considerations
- Context building typically completes in <500ms
- Redis caching reduces subsequent calls to <50ms
- All database queries run in parallel
- Keyword filtering reduces data payload size

## Testing
Comprehensive unit tests are available in `__tests__/services/chatContextBuilder.test.js` with 100% coverage.

Run tests:
```bash
npm test -- src/__tests__/services/chatContextBuilder.test.js
```