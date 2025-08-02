const { PromptEngineeringService, IntentCategory } = require('../../services/promptEngineering');

describe('PromptEngineeringService', () => {
  let promptService;

  beforeEach(() => {
    promptService = new PromptEngineeringService();
  });

  describe('classifyIntent', () => {
    it('should classify reorder advice correctly', () => {
      const testMessages = [
        'Should I reorder Product A?',
        'When should I buy more inventory?',
        'I need to order more stock',
        'Should I purchase additional units?'
      ];

      testMessages.forEach(message => {
        const intent = promptService.classifyIntent(message);
        expect(intent).toBe(IntentCategory.REORDER_ADVICE);
      });
    });

    it('should classify forecast explanation correctly', () => {
      const testMessages = [
        'Why is the forecast showing high demand?',
        'Can you explain this prediction?',
        'What does the forecast mean?',
        'Why do you predict increased sales?'
      ];

      testMessages.forEach(message => {
        const intent = promptService.classifyIntent(message);
        expect(intent).toBe(IntentCategory.FORECAST_EXPLANATION);
      });
    });

    it('should classify seasonal insights correctly', () => {
      const testMessages = [
        'What are the seasonal trends?',
        'How do holidays affect sales?',
        'What happens during Christmas season?',
        'Tell me about summer patterns'
      ];

      testMessages.forEach(message => {
        const intent = promptService.classifyIntent(message);
        expect(intent).toBe(IntentCategory.SEASONAL_INSIGHTS);
      });
    });

    it('should classify stock status correctly', () => {
      const testMessages = [
        'What is my current stock level?',
        'How much inventory do I have?',
        'Show me stock status',
        'How many units are left?'
      ];

      testMessages.forEach(message => {
        const intent = promptService.classifyIntent(message);
        expect(intent).toBe(IntentCategory.STOCK_STATUS);
      });
    });

    it('should classify trend analysis correctly', () => {
      const testMessages = [
        'What are the sales trends?',
        'Is my performance improving?',
        'Show me sales growth',
        'Are sales trending up?'
      ];

      testMessages.forEach(message => {
        const intent = promptService.classifyIntent(message);
        expect(intent).toBe(IntentCategory.TREND_ANALYSIS);
      });
    });

    it('should default to general inquiry for unclear messages', () => {
      const testMessages = [
        'Hello',
        'Can you help me?',
        'I have a question',
        'What can you do?'
      ];

      testMessages.forEach(message => {
        const intent = promptService.classifyIntent(message);
        expect(intent).toBe(IntentCategory.GENERAL_INQUIRY);
      });
    });
  });

  describe('buildPrompt', () => {
    const mockContext = {
      userMessage: 'Should I reorder Product A?',
      chatContext: {
        user: { userId: 'user123', name: 'John Doe' },
        store: { storeName: 'Test Store', businessType: 'retail' },
        inventory: {
          totalProducts: 100,
          lowStockProducts: [
            { name: 'Product A', currentStock: 5 },
            { name: 'Product B', currentStock: 3 }
          ],
          inventoryValue: 50000
        },
        forecasts: [
          {
            productName: 'Product A',
            currentStock: 5,
            predictedDemand: [{ quantity: 50 }],
            confidence: 85
          }
        ],
        seasonalPatterns: [
          {
            period: 'December',
            description: 'Holiday rush',
            impact: 150
          }
        ],
        recentEvents: [],
        salesTrends: {
          period: 30,
          direction: 'up',
          percentage: 15
        },
        timestamp: new Date('2024-01-15')
      },
      conversationHistory: [],
      intentCategory: IntentCategory.REORDER_ADVICE
    };

    it('should generate appropriate prompts for each template', () => {
      const templates = [
        IntentCategory.REORDER_ADVICE,
        IntentCategory.FORECAST_EXPLANATION,
        IntentCategory.SEASONAL_INSIGHTS,
        IntentCategory.STOCK_STATUS,
        IntentCategory.TREND_ANALYSIS,
        IntentCategory.GENERAL_INQUIRY
      ];

      templates.forEach(intentCategory => {
        const context = { ...mockContext, intentCategory };
        const { prompt, config } = promptService.buildPrompt(context);
        
        expect(prompt).toBeTruthy();
        expect(prompt).toContain(mockContext.userMessage);
        expect(config.maxTokens).toBe(200);
        expect(config.temperature).toBeGreaterThanOrEqual(0.2);
        expect(config.temperature).toBeLessThanOrEqual(0.4);
      });
    });

    it('should include context data in the prompt', () => {
      const { prompt } = promptService.buildPrompt(mockContext);
      
      expect(prompt).toContain('Test Store');
      expect(prompt).toContain('100');
      expect(prompt).toContain('50,000');
      expect(prompt).toContain('Product A');
      expect(prompt).toContain('Holiday rush');
    });

    it('should handle missing data gracefully', () => {
      const contextWithMissingData = {
        ...mockContext,
        chatContext: {
          ...mockContext.chatContext,
          inventory: null,
          forecasts: [],
          seasonalPatterns: null
        }
      };

      const { prompt } = promptService.buildPrompt(contextWithMissingData);
      
      expect(prompt).toContain('No specific product forecasts available');
      expect(prompt).toContain('No clear seasonal patterns detected yet');
    });

    it('should format product data correctly', () => {
      const { prompt } = promptService.buildPrompt(mockContext);
      
      expect(prompt).toContain('Product A: Current stock 5, Predicted demand 50 units, Confidence 85%');
    });

    it('should format seasonal patterns correctly', () => {
      const { prompt } = promptService.buildPrompt(mockContext);
      
      expect(prompt).toContain('December: Holiday rush (150% impact)');
    });

    it('should format trends correctly', () => {
      const { prompt } = promptService.buildPrompt(mockContext);
      
      expect(prompt).toContain('Recent 30-day trend: up (15% change)');
    });
  });

  describe('template configuration', () => {
    it('should have appropriate temperature settings for each intent', () => {
      const expectedTemperatures = {
        [IntentCategory.REORDER_ADVICE]: 0.3,
        [IntentCategory.FORECAST_EXPLANATION]: 0.2,
        [IntentCategory.SEASONAL_INSIGHTS]: 0.3,
        [IntentCategory.STOCK_STATUS]: 0.2,
        [IntentCategory.TREND_ANALYSIS]: 0.3,
        [IntentCategory.GENERAL_INQUIRY]: 0.4
      };

      Object.entries(expectedTemperatures).forEach(([intent, expectedTemp]) => {
        const context = {
          userMessage: 'test',
          chatContext: {
            timestamp: new Date()
          },
          conversationHistory: [],
          intentCategory: intent
        };

        const { config } = promptService.buildPrompt(context);
        expect(config.temperature).toBe(expectedTemp);
      });
    });

    it('should limit all responses to 200 tokens', () => {
      const intents = Object.values(IntentCategory);
      
      intents.forEach(intent => {
        const context = {
          userMessage: 'test',
          chatContext: {
            timestamp: new Date()
          },
          conversationHistory: [],
          intentCategory: intent
        };

        const { config } = promptService.buildPrompt(context);
        expect(config.maxTokens).toBe(200);
      });
    });
  });

  describe('edge cases', () => {
    it('should handle empty user messages', () => {
      const context = {
        userMessage: '',
        chatContext: {
          timestamp: new Date()
        },
        conversationHistory: [],
        intentCategory: IntentCategory.GENERAL_INQUIRY
      };

      const { prompt } = promptService.buildPrompt(context);
      expect(prompt).toBeTruthy();
    });

    it('should handle very long user messages', () => {
      const longMessage = 'a'.repeat(1000);
      const intent = promptService.classifyIntent(longMessage);
      expect(intent).toBe(IntentCategory.GENERAL_INQUIRY);
    });

    it('should handle mixed case in intent classification', () => {
      const mixedCaseMessages = [
        'SHOULD I REORDER?',
        'SeAsOnAl TrEnDs',
        'FORECAST explanation'
      ];

      const expectedIntents = [
        IntentCategory.REORDER_ADVICE,
        IntentCategory.SEASONAL_INSIGHTS,
        IntentCategory.FORECAST_EXPLANATION
      ];

      mixedCaseMessages.forEach((message, index) => {
        const intent = promptService.classifyIntent(message);
        expect(intent).toBe(expectedIntents[index]);
      });
    });
  });
});