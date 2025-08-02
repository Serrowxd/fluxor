const Analytics = require('../models/Analytics');
const Forecast = require('../models/Forecast');
const Product = require('../models/Product');
const Store = require('../models/Store');
const User = require('../models/User');
const Sale = require('../models/Sale');
const { chatCache } = require('../../config/redis');

class ChatContextBuilder {
  constructor() {
    // Dependencies are loaded via models to match existing pattern
  }

  /**
   * Build comprehensive chat context by aggregating data from multiple sources
   * @param {string} userId - User ID
   * @param {string} storeId - Store ID  
   * @param {string} userMessage - User's message to help filter relevant data
   * @returns {Promise<Object>} - Aggregated chat context
   */
  async buildContext(userId, storeId, userMessage) {
    try {
      // Check cache first
      const cachedContext = await chatCache.getContext(userId, storeId);
      if (cachedContext && this.isCacheValid(cachedContext, userMessage)) {
        console.log('Using cached context for user:', userId);
        return cachedContext;
      }

      // Parallel data fetching for performance
      const [
        user,
        store,
        inventory,
        forecasts,
        seasonalPatterns,
        recentEvents,
        salesTrends,
        dashboardMetrics
      ] = await Promise.all([
        this.getUserProfile(userId),
        this.getStoreData(storeId),
        this.getInventorySnapshot(storeId),
        this.getActiveForecasts(storeId),
        this.getSeasonalPatterns(storeId),
        this.getRecentEvents(storeId, 90), // Last 90 days
        this.getSalesTrends(storeId, 30), // Last 30 days
        Analytics.getDashboardMetrics(storeId)
      ]);

      // Filter relevant data based on user message
      const relevantData = this.filterRelevantData(
        { inventory, forecasts, seasonalPatterns, recentEvents, salesTrends },
        userMessage
      );

      const context = {
        user,
        store,
        inventory: relevantData.inventory,
        forecasts: relevantData.forecasts,
        seasonalPatterns: relevantData.seasonalPatterns,
        recentEvents: relevantData.recentEvents,
        salesTrends: relevantData.salesTrends,
        dashboardMetrics: dashboardMetrics.summary,
        timestamp: new Date()
      };

      // Cache the context
      await chatCache.setContext(userId, storeId, context);

      return context;
    } catch (error) {
      console.error('Error building chat context:', error);
      throw new Error('Failed to build context for chat response');
    }
  }

  /**
   * Get user profile information
   */
  async getUserProfile(userId) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    return {
      userId: user.user_id,
      email: user.email,
      createdAt: user.created_at
    };
  }

  /**
   * Get store information
   */
  async getStoreData(storeId) {
    const store = await Store.findById(storeId);
    if (!store) {
      throw new Error('Store not found');
    }
    return {
      storeId: store.store_id,
      storeName: store.store_name,
      businessType: store.business_type || 'retail',
      createdAt: store.created_at
    };
  }

  /**
   * Get inventory snapshot with low stock and reorder suggestions
   */
  async getInventorySnapshot(storeId) {
    try {
      // Get stock level analytics
      const stockAnalytics = await Analytics.getStockLevelAnalytics(storeId);
      
      // Get reorder suggestions from forecast model
      const reorderSuggestions = await Forecast.getReorderSuggestions(storeId);
      
      // Calculate inventory metrics
      const totalProducts = stockAnalytics.length;
      const lowStockProducts = stockAnalytics
        .filter(p => p.stock_status === 'critical' || p.stock_status === 'low')
        .map(p => ({
          productId: p.product_id,
          productName: p.product_name,
          sku: p.sku,
          currentStock: p.current_stock,
          reorderPoint: p.reorder_point,
          daysOfSupply: p.days_of_supply_month || 0,
          stockStatus: p.stock_status
        }));

      const overstockProducts = stockAnalytics
        .filter(p => p.stock_status === 'overstock')
        .map(p => ({
          productId: p.product_id,
          productName: p.product_name,
          sku: p.sku,
          currentStock: p.current_stock,
          maxStockLevel: p.max_stock_level,
          daysOfSupply: p.days_of_supply_month || 0
        }));

      // Get carrying costs for inventory value
      const carryingCosts = await Analytics.calculateCarryingCosts(storeId);
      const inventoryValue = carryingCosts.reduce(
        (sum, product) => sum + (product.inventory_value || 0),
        0
      );

      // Get top performers based on turnover
      const turnoverData = await Analytics.calculateInventoryTurnover(storeId, '30 days');
      const topPerformers = turnoverData
        .filter(p => p.performance_category === 'excellent' || p.performance_category === 'good')
        .slice(0, 5)
        .map(p => ({
          productId: p.product_id,
          productName: p.product_name,
          sku: p.sku,
          turnoverRatio: p.turnover_ratio,
          performanceCategory: p.performance_category
        }));

      return {
        totalProducts,
        lowStockProducts,
        overstockProducts,
        reorderSuggestions: reorderSuggestions.slice(0, 10), // Top 10 suggestions
        inventoryValue: Math.round(inventoryValue * 100) / 100,
        topPerformers
      };
    } catch (error) {
      console.error('Error getting inventory snapshot:', error);
      return {
        totalProducts: 0,
        lowStockProducts: [],
        overstockProducts: [],
        reorderSuggestions: [],
        inventoryValue: 0,
        topPerformers: []
      };
    }
  }

  /**
   * Get active forecasts with confidence scores
   */
  async getActiveForecasts(storeId) {
    try {
      const forecasts = await Forecast.getLatestForecasts(storeId, 30);
      
      return forecasts.map(forecast => ({
        productId: forecast.product_id,
        productName: forecast.product_name,
        sku: forecast.sku,
        currentStock: forecast.current_stock || 0,
        predictedDemand: [{
          date: forecast.forecast_date,
          quantity: forecast.predicted_demand
        }],
        confidence: this.mapConfidenceToPercentage(forecast.confidence_level),
        confidenceLevel: forecast.confidence_level,
        trendDirection: this.calculateTrendDirection(forecast),
        riskFactors: this.identifyRiskFactors(forecast)
      }));
    } catch (error) {
      console.error('Error getting active forecasts:', error);
      return [];
    }
  }

  /**
   * Get seasonal patterns from historical data
   */
  async getSeasonalPatterns(storeId) {
    try {
      // Get sales data grouped by month to identify patterns
      const historicalSales = await Sale.getHistoricalSalesByMonth(storeId);
      
      const patterns = [];
      const currentMonth = new Date().getMonth();
      
      // Analyze each month's data
      historicalSales.forEach(monthData => {
        const monthNum = parseInt(monthData.month) - 1; // Convert to 0-based
        const avgSales = parseFloat(monthData.avg_daily_sales);
        const totalRevenue = parseFloat(monthData.total_revenue);
        
        // Calculate seasonal impact
        const yearlyAvg = historicalSales.reduce((sum, m) => sum + parseFloat(m.avg_daily_sales), 0) / historicalSales.length;
        const impact = Math.round(((avgSales - yearlyAvg) / yearlyAvg) * 100);
        
        if (Math.abs(impact) > 10) { // Only significant patterns
          patterns.push({
            period: this.getMonthName(monthNum),
            description: impact > 0 ? 'High demand period' : 'Low demand period',
            impact: impact,
            averageDailySales: avgSales,
            isCurrentPeriod: monthNum === currentMonth
          });
        }
      });
      
      return patterns.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
    } catch (error) {
      console.error('Error getting seasonal patterns:', error);
      return [];
    }
  }

  /**
   * Get recent business events (stockouts, large orders, etc.)
   */
  async getRecentEvents(storeId, days) {
    try {
      const events = [];
      
      // Get stockout data
      const stockoutData = await Analytics.calculateStockoutRate(storeId, `${days} days`);
      stockoutData
        .filter(p => p.stockout_events > 0)
        .forEach(product => {
          events.push({
            type: 'stockout',
            productName: product.product_name,
            date: new Date(Date.now() - (Math.random() * days * 24 * 60 * 60 * 1000)), // Simulated date
            impact: `${product.lost_revenue || 0} in lost revenue`,
            severity: product.stockout_rate_percent > 10 ? 'high' : 'medium'
          });
        });
      
      // Sort by date
      return events.sort((a, b) => b.date - a.date).slice(0, 10);
    } catch (error) {
      console.error('Error getting recent events:', error);
      return [];
    }
  }

  /**
   * Get sales trends and analysis
   */
  async getSalesTrends(storeId, days) {
    try {
      const salesData = await Sale.getSalesTrends(storeId, days);
      
      if (!salesData || salesData.length === 0) {
        return {
          period: `${days}-day`,
          direction: 'stable',
          percentage: 0,
          dataPoints: 0
        };
      }
      
      // Calculate trend - need at least 7 days for comparison
      const daysForAvg = Math.min(7, salesData.length);
      const firstWeekAvg = salesData.slice(0, daysForAvg).reduce((sum, d) => sum + parseFloat(d.daily_revenue), 0) / daysForAvg;
      const lastWeekAvg = salesData.slice(-daysForAvg).reduce((sum, d) => sum + parseFloat(d.daily_revenue), 0) / daysForAvg;
      
      const percentageChange = firstWeekAvg > 0 ? ((lastWeekAvg - firstWeekAvg) / firstWeekAvg) * 100 : 0;
      
      return {
        period: `${days}-day`,
        direction: percentageChange > 5 ? 'up' : percentageChange < -5 ? 'down' : 'stable',
        percentage: Math.round(percentageChange * 100) / 100,
        dataPoints: salesData.length,
        averageDailyRevenue: Math.round(salesData.reduce((sum, d) => sum + parseFloat(d.daily_revenue), 0) / salesData.length),
        totalRevenue: Math.round(salesData.reduce((sum, d) => sum + parseFloat(d.daily_revenue), 0))
      };
    } catch (error) {
      console.error('Error getting sales trends:', error);
      return {
        period: `${days}-day`,
        direction: 'stable',
        percentage: 0,
        dataPoints: 0
      };
    }
  }

  /**
   * Filter data based on relevance to user message
   */
  filterRelevantData(data, userMessage) {
    // Extract keywords from user message
    const keywords = this.extractKeywords(userMessage.toLowerCase());
    
    // Filter forecasts and inventory based on relevance
    const relevantForecasts = data.forecasts.filter(forecast => 
      keywords.some(keyword => 
        forecast.productName.toLowerCase().includes(keyword) ||
        forecast.sku?.toLowerCase().includes(keyword)
      )
    );

    // If no specific products mentioned, return summary data
    if (relevantForecasts.length === 0) {
      return {
        inventory: this.summarizeInventory(data.inventory),
        forecasts: data.forecasts.slice(0, 5), // Top 5 most relevant
        seasonalPatterns: data.seasonalPatterns,
        recentEvents: data.recentEvents,
        salesTrends: data.salesTrends
      };
    }

    // Return filtered data focused on mentioned products
    const relevantProductIds = new Set(relevantForecasts.map(f => f.productId));
    
    return {
      inventory: {
        ...data.inventory,
        lowStockProducts: data.inventory.lowStockProducts.filter(p => 
          relevantProductIds.has(p.productId)
        ),
        reorderSuggestions: data.inventory.reorderSuggestions.filter(s => 
          relevantProductIds.has(s.product_id)
        )
      },
      forecasts: relevantForecasts,
      seasonalPatterns: data.seasonalPatterns,
      recentEvents: data.recentEvents.filter(e => 
        keywords.some(k => e.productName?.toLowerCase().includes(k))
      ),
      salesTrends: data.salesTrends
    };
  }

  /**
   * Extract keywords from user message
   */
  extractKeywords(message) {
    // Remove common words and extract meaningful terms
    const stopWords = new Set(['the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but', 'in', 'with', 'to', 'for', 'of', 'as', 'by', 'that', 'this', 'it', 'from', 'be', 'are', 'been', 'was', 'were', 'what', 'when', 'where', 'how', 'why', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'should', 'do', 'does', 'did', 'have', 'has', 'had', 'get', 'got', 'getting']);
    
    // Extract words and filter out stop words
    const words = message
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
    
    // Add action keywords if present in message
    const actionKeywords = ['reorder', 'stock', 'forecast', 'seasonal', 'trend', 'low', 'high', 'out', 'stockout', 'overstock', 'inventory', 'sales', 'revenue', 'performance'];
    const presentActions = actionKeywords.filter(keyword => message.includes(keyword));
    
    return [...new Set([...words, ...presentActions])];
  }

  /**
   * Summarize inventory for high-level queries
   */
  summarizeInventory(inventory) {
    return {
      ...inventory,
      lowStockProducts: (inventory.lowStockProducts || []).slice(0, 3),
      overstockProducts: (inventory.overstockProducts || []).slice(0, 3),
      reorderSuggestions: (inventory.reorderSuggestions || []).slice(0, 3),
      topPerformers: (inventory.topPerformers || []).slice(0, 3)
    };
  }

  /**
   * Check if cached context is still valid
   */
  isCacheValid(cachedContext, userMessage) {
    // Cache is invalid if it's older than 5 minutes
    const cacheAge = Date.now() - new Date(cachedContext.timestamp).getTime();
    if (cacheAge > 5 * 60 * 1000) {
      return false;
    }
    
    // For now, use cache for similar queries
    // In production, implement more sophisticated cache invalidation
    return true;
  }

  /**
   * Map confidence level to percentage
   */
  mapConfidenceToPercentage(confidenceLevel) {
    const mapping = {
      'high': 85,
      'medium': 65,
      'low': 45
    };
    return mapping[confidenceLevel] || 50;
  }

  /**
   * Calculate trend direction from forecast data
   */
  calculateTrendDirection(forecast) {
    // Simple logic - can be enhanced with historical comparison
    if (forecast.predicted_demand > forecast.current_stock * 1.2) {
      return 'up';
    } else if (forecast.predicted_demand < forecast.current_stock * 0.8) {
      return 'down';
    }
    return 'stable';
  }

  /**
   * Identify risk factors for a forecast
   */
  identifyRiskFactors(forecast) {
    const risks = [];
    
    if (forecast.confidence_level === 'low') {
      risks.push('Low confidence forecast');
    }
    
    if (forecast.current_stock < forecast.predicted_demand) {
      risks.push('Potential stockout risk');
    }
    
    if (forecast.predicted_demand === 0) {
      risks.push('No demand predicted');
    }
    
    return risks;
  }

  /**
   * Get month name from number
   */
  getMonthName(monthNum) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                   'July', 'August', 'September', 'October', 'November', 'December'];
    return months[monthNum] || 'Unknown';
  }
}

module.exports = ChatContextBuilder;