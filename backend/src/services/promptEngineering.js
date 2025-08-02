const IntentCategory = {
  REORDER_ADVICE: 'reorder_advice',
  FORECAST_EXPLANATION: 'forecast_explanation',
  SEASONAL_INSIGHTS: 'seasonal_insights',
  GENERAL_INQUIRY: 'general_inquiry',
  TREND_ANALYSIS: 'trend_analysis',
  STOCK_STATUS: 'stock_status'
};

class PromptEngineeringService {
  constructor() {
    this.templates = new Map();
    this.initializeTemplates();
  }

  initializeTemplates() {
    this.templates.set(IntentCategory.REORDER_ADVICE, {
      name: 'reorder_advice',
      template: `You are an experienced inventory expert helping a small business owner make reorder decisions.

BUSINESS CONTEXT:
- Store: {storeName}
- Current date: {currentDate}
- Business type: {businessType}

INVENTORY DATA:
- Total products: {totalProducts}
- Low stock items: {lowStockCount}
- Current inventory value: {inventoryValue}

SPECIFIC PRODUCT DATA:
{productData}

SEASONAL PATTERNS:
{seasonalPatterns}

RECENT TRENDS:
{recentTrends}

USER QUESTION: "{userMessage}"

Please provide a friendly, conversational response that:
1. Directly answers their question about reordering
2. References specific numbers from the data
3. Explains the reasoning behind your recommendation
4. Mentions any relevant seasonal or trend factors
5. Suggests specific quantities and timing
6. Keeps the response under 150 words
7. Uses a supportive, expert tone

Format your response as natural conversation, not bullet points.`,
      maxTokens: 200,
      temperature: 0.3
    });

    this.templates.set(IntentCategory.FORECAST_EXPLANATION, {
      name: 'forecast_explanation',
      template: `You are an AI inventory assistant explaining forecast predictions to a business owner.

FORECAST DATA:
{forecastData}

HISTORICAL CONTEXT:
{historicalContext}

CONFIDENCE FACTORS:
{confidenceFactors}

USER QUESTION: "{userMessage}"

Explain the forecast in simple terms by:
1. Stating the prediction clearly
2. Explaining what data led to this prediction
3. Mentioning the confidence level and why
4. Highlighting any important patterns or trends
5. Suggesting how to use this information
6. Keeping it conversational and under 150 words

Avoid technical jargon and focus on actionable insights.`,
      maxTokens: 200,
      temperature: 0.2
    });

    this.templates.set(IntentCategory.SEASONAL_INSIGHTS, {
      name: 'seasonal_insights',
      template: `You are helping a business owner understand seasonal patterns in their inventory.

SEASONAL DATA:
{seasonalData}

YEAR-OVER-YEAR COMPARISON:
{yearOverYearData}

CURRENT POSITION:
{currentPosition}

USER QUESTION: "{userMessage}"

Provide insights about seasonality by:
1. Identifying key seasonal patterns
2. Comparing current performance to last year
3. Predicting upcoming seasonal changes
4. Suggesting preparation strategies
5. Mentioning any unusual patterns
6. Keeping the tone friendly and informative
7. Limiting response to 150 words

Focus on actionable seasonal strategies.`,
      maxTokens: 200,
      temperature: 0.3
    });

    this.templates.set(IntentCategory.STOCK_STATUS, {
      name: 'stock_status',
      template: `You are an inventory assistant providing stock level insights to a business owner.

CURRENT INVENTORY STATUS:
{inventoryStatus}

LOW STOCK ALERTS:
{lowStockAlerts}

OVERSTOCK ITEMS:
{overstockItems}

RECENT MOVEMENT:
{recentMovement}

USER QUESTION: "{userMessage}"

Provide a clear response that:
1. Addresses their stock inquiry directly
2. Highlights critical stock levels
3. Suggests immediate actions if needed
4. References specific products and quantities
5. Mentions any concerning patterns
6. Keeps the response concise and actionable
7. Limits response to 150 words

Focus on what needs attention now.`,
      maxTokens: 200,
      temperature: 0.2
    });

    this.templates.set(IntentCategory.TREND_ANALYSIS, {
      name: 'trend_analysis',
      template: `You are analyzing sales and inventory trends for a business owner.

TREND DATA:
{trendData}

PERFORMANCE METRICS:
{performanceMetrics}

COMPARATIVE ANALYSIS:
{comparativeAnalysis}

USER QUESTION: "{userMessage}"

Provide trend insights that:
1. Clearly identify the trend direction
2. Explain what's driving the trend
3. Compare to historical performance
4. Suggest strategic responses
5. Highlight opportunities or risks
6. Keep analysis practical and actionable
7. Limit response to 150 words

Focus on business impact and next steps.`,
      maxTokens: 200,
      temperature: 0.3
    });

    this.templates.set(IntentCategory.GENERAL_INQUIRY, {
      name: 'general_inquiry',
      template: `You are a helpful inventory assistant for a small business.

BUSINESS OVERVIEW:
{businessOverview}

CURRENT METRICS:
{currentMetrics}

USER QUESTION: "{userMessage}"

Provide a helpful response that:
1. Addresses their question directly
2. References relevant data when available
3. Offers practical advice
4. Suggests next steps if appropriate
5. Maintains a friendly, expert tone
6. Keeps the response under 150 words

If you don't have specific data to answer their question, acknowledge this and offer to help with related information you do have.`,
      maxTokens: 200,
      temperature: 0.4
    });
  }

  buildPrompt(context) {
    const template = this.templates.get(context.intentCategory) || 
                    this.templates.get(IntentCategory.GENERAL_INQUIRY);

    const prompt = this.populateTemplate(template.template, context);
    
    return {
      prompt,
      config: template
    };
  }

  populateTemplate(template, context) {
    const { chatContext, userMessage } = context;
    
    const replacements = {
      storeName: chatContext.store?.storeName || 'Your Store',
      currentDate: chatContext.timestamp.toLocaleDateString(),
      businessType: chatContext.store?.businessType || 'retail',
      totalProducts: chatContext.inventory?.totalProducts?.toString() || '0',
      lowStockCount: chatContext.inventory?.lowStockProducts?.length?.toString() || '0',
      inventoryValue: chatContext.inventory?.inventoryValue?.toLocaleString() || '0',
      userMessage: userMessage,
      productData: this.formatProductData(chatContext.forecasts),
      seasonalPatterns: this.formatSeasonalPatterns(chatContext.seasonalPatterns),
      recentTrends: this.formatTrends(chatContext.salesTrends),
      forecastData: this.formatForecastData(chatContext.forecasts),
      historicalContext: this.formatHistoricalContext(chatContext),
      confidenceFactors: this.formatConfidenceFactors(chatContext.forecasts),
      seasonalData: this.formatSeasonalData(chatContext.seasonalPatterns),
      yearOverYearData: this.formatYearOverYearData(chatContext),
      currentPosition: this.formatCurrentPosition(chatContext),
      businessOverview: this.formatBusinessOverview(chatContext),
      currentMetrics: this.formatCurrentMetrics(chatContext),
      inventoryStatus: this.formatInventoryStatus(chatContext.inventory),
      lowStockAlerts: this.formatLowStockAlerts(chatContext.inventory),
      overstockItems: this.formatOverstockItems(chatContext.inventory),
      recentMovement: this.formatRecentMovement(chatContext.salesTrends),
      trendData: this.formatTrendData(chatContext.salesTrends),
      performanceMetrics: this.formatPerformanceMetrics(chatContext),
      comparativeAnalysis: this.formatComparativeAnalysis(chatContext)
    };

    let populatedTemplate = template;
    Object.entries(replacements).forEach(([key, value]) => {
      populatedTemplate = populatedTemplate.replace(
        new RegExp(`{${key}}`, 'g'), 
        value || 'Not available'
      );
    });

    return populatedTemplate;
  }

  formatProductData(forecasts) {
    if (!forecasts || forecasts.length === 0) {
      return 'No specific product forecasts available';
    }
    
    return forecasts.slice(0, 3).map(forecast => 
      `${forecast.productName}: Current stock ${forecast.currentStock}, ` +
      `Predicted demand ${forecast.predictedDemand?.[0]?.quantity || 'N/A'} units, ` +
      `Confidence ${forecast.confidence}%`
    ).join('\n');
  }

  formatSeasonalPatterns(patterns) {
    if (!patterns || patterns.length === 0) {
      return 'No clear seasonal patterns detected yet.';
    }
    
    return patterns.map(pattern =>
      `${pattern.period}: ${pattern.description} (${pattern.impact}% impact)`
    ).join('\n');
  }

  formatTrends(trends) {
    if (!trends) {
      return 'No trend data available';
    }
    return `Recent ${trends.period || 30}-day trend: ${trends.direction || 'stable'} (${trends.percentage || 0}% change)`;
  }

  formatForecastData(forecasts) {
    if (!forecasts || forecasts.length === 0) {
      return 'No forecast data available';
    }
    return forecasts.slice(0, 3).map(f => 
      `${f.productName}: ${f.predictedDemand?.[0]?.quantity || 'N/A'} units`
    ).join(', ');
  }

  formatHistoricalContext(context) {
    const dataPoints = context.salesTrends?.dataPoints || 30;
    return `Based on ${dataPoints} days of sales data`;
  }

  formatConfidenceFactors(forecasts) {
    if (!forecasts || forecasts.length === 0) {
      return 'Confidence data not available';
    }
    const avgConfidence = forecasts.reduce((sum, f) => sum + (f.confidence || 0), 0) / forecasts.length;
    return `Average prediction confidence: ${avgConfidence.toFixed(1)}%`;
  }

  formatSeasonalData(patterns) {
    return this.formatSeasonalPatterns(patterns);
  }

  formatYearOverYearData(context) {
    const direction = context.salesTrends?.yearOverYearDirection || 'stable';
    return `Sales trend: ${direction} compared to last year`;
  }

  formatCurrentPosition(context) {
    const totalProducts = context.inventory?.totalProducts || 0;
    const inventoryValue = context.inventory?.inventoryValue || 0;
    return `Current inventory: ${totalProducts} products, $${inventoryValue.toLocaleString()} value`;
  }

  formatBusinessOverview(context) {
    const storeName = context.store?.storeName || 'Your Store';
    const totalProducts = context.inventory?.totalProducts || 0;
    return `${storeName} - ${totalProducts} products`;
  }

  formatCurrentMetrics(context) {
    const inventoryValue = context.inventory?.inventoryValue || 0;
    const lowStockCount = context.inventory?.lowStockProducts?.length || 0;
    return `Inventory value: $${inventoryValue.toLocaleString()}, Low stock items: ${lowStockCount}`;
  }

  formatInventoryStatus(inventory) {
    if (!inventory) {
      return 'Inventory status unavailable';
    }
    return `Total products: ${inventory.totalProducts || 0}, ` +
           `Low stock: ${inventory.lowStockProducts?.length || 0}, ` +
           `Overstock: ${inventory.overstockProducts?.length || 0}`;
  }

  formatLowStockAlerts(inventory) {
    if (!inventory?.lowStockProducts || inventory.lowStockProducts.length === 0) {
      return 'No low stock alerts';
    }
    return inventory.lowStockProducts.slice(0, 3).map(p => 
      `${p.name}: ${p.currentStock} units remaining`
    ).join('\n');
  }

  formatOverstockItems(inventory) {
    if (!inventory?.overstockProducts || inventory.overstockProducts.length === 0) {
      return 'No overstock items';
    }
    return inventory.overstockProducts.slice(0, 3).map(p => 
      `${p.name}: ${p.currentStock} units (${p.daysInStock} days)`
    ).join('\n');
  }

  formatRecentMovement(trends) {
    if (!trends) {
      return 'No recent movement data';
    }
    return `${trends.topMover || 'N/A'} (${trends.topMoverChange || 0}% change)`;
  }

  formatTrendData(trends) {
    return this.formatTrends(trends);
  }

  formatPerformanceMetrics(context) {
    const metrics = context.inventory?.metrics || {};
    return `Turnover rate: ${metrics.turnoverRate || 'N/A'}, ` +
           `Stockout rate: ${metrics.stockoutRate || 'N/A'}%`;
  }

  formatComparativeAnalysis(context) {
    const comparison = context.salesTrends?.comparison || {};
    return `vs. Last period: ${comparison.change || 0}% ${comparison.direction || 'change'}`;
  }

  classifyIntent(userMessage) {
    const message = userMessage.toLowerCase();
    
    if (message.includes('reorder') || message.includes('should i buy') || 
        message.includes('order more') || message.includes('purchase')) {
      return IntentCategory.REORDER_ADVICE;
    }
    
    if (message.includes('forecast') || message.includes('predict') || 
        message.includes('why') || message.includes('explain')) {
      return IntentCategory.FORECAST_EXPLANATION;
    }
    
    if (message.includes('season') || message.includes('holiday') || 
        message.includes('christmas') || message.includes('summer')) {
      return IntentCategory.SEASONAL_INSIGHTS;
    }
    
    if (message.includes('stock') || message.includes('inventory') || 
        message.includes('how much') || message.includes('how many')) {
      return IntentCategory.STOCK_STATUS;
    }
    
    if (message.includes('trend') || message.includes('sales') || 
        message.includes('performance') || message.includes('growing')) {
      return IntentCategory.TREND_ANALYSIS;
    }
    
    return IntentCategory.GENERAL_INQUIRY;
  }
}

module.exports = { PromptEngineeringService, IntentCategory };