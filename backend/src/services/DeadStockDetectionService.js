const DeadStockAnalysis = require("../models/DeadStockAnalysis");
const Sale = require("../models/Sale");
const Product = require("../models/Product");
const Store = require("../models/Store");
const ForecastAccuracy = require("../models/ForecastAccuracy");
const db = require("../../config/database");

class DeadStockDetectionService {
  /**
   * Run comprehensive dead stock detection across all stores
   */
  static async runGlobalDeadStockDetection(config = {}) {
    try {
      console.log("Starting global dead stock detection...");

      const stores = await Store.findAll();
      const results = [];

      for (const store of stores) {
        try {
          const storeResult = await this.runDeadStockDetectionForStore(
            store.store_id,
            config
          );
          results.push({
            storeId: store.store_id,
            ...storeResult,
          });
        } catch (error) {
          console.error(
            `Error running dead stock detection for store ${store.store_id}:`,
            error
          );
          results.push({
            storeId: store.store_id,
            error: error.message,
          });
        }
      }

      console.log(
        `Global dead stock detection completed for ${results.length} stores`
      );
      return results;
    } catch (error) {
      console.error("Global dead stock detection failed:", error);
      throw error;
    }
  }

  /**
   * Run dead stock detection for a specific store with advanced algorithms
   */
  static async runDeadStockDetectionForStore(storeId, config = {}) {
    try {
      const defaultConfig = {
        slowMovingDays: 30,
        deadStockDays: 60,
        obsoleteDays: 90,
        minStockValue: 10,
        velocityThreshold: 0.1, // Items per day
        seasonalityAdjustment: true,
        includeForecasting: true,
      };

      const detectionConfig = { ...defaultConfig, ...config };

      // Get products with sales history and inventory data
      const products = await DeadStockDetectionService.getProductsWithHistoricalData(storeId);

      const analysisResults = [];

      for (const product of products) {
        try {
          const analysis = await this.analyzeProductDeadStockRisk(
            product,
            detectionConfig
          );
          if (analysis) {
            analysisResults.push(analysis);
          }
        } catch (error) {
          console.error(
            `Error analyzing product ${product.product_id}:`,
            error
          );
        }
      }

      // Save results to database
      const savedResults = [];
      for (const analysis of analysisResults) {
        try {
          const saved = await DeadStockAnalysis.create(analysis);
          savedResults.push(saved);
        } catch (error) {
          console.error(
            `Error saving analysis for product ${analysis.productId}:`,
            error
          );
        }
      }

      // Generate actionable insights
      const insights = await this.generateDeadStockInsights(
        analysisResults,
        detectionConfig
      );

      return {
        totalProductsAnalyzed: products.length,
        deadStockItemsFound: analysisResults.length,
        savedResults: savedResults.length,
        insights,
        config: detectionConfig,
        analyzedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(
        `Error running dead stock detection for store ${storeId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Analyze individual product for dead stock risk
   */
  static async analyzeProductDeadStockRisk(product, config) {
    try {
      // Get sales history for the product
      const salesHistory = await Sale.findByProductId(
        product.product_id,
        new Date(Date.now() - 180 * 24 * 60 * 60 * 1000), // Last 6 months
        new Date()
      );

      if (salesHistory.length === 0) {
        // Product with no sales in 6 months
        return this.createDeadStockAnalysis(
          product,
          {
            daysWithoutSale: 180,
            velocityScore: 0,
            classification: "obsolete",
            liquidationPriority: 10,
            reason: "No sales in 6 months",
          },
          config
        );
      }

      // Calculate last sale date and days without sale
      const lastSaleDate = new Date(
        Math.max(...salesHistory.map((sale) => new Date(sale.sale_date)))
      );
      const daysWithoutSale = Math.floor(
        (new Date() - lastSaleDate) / (24 * 60 * 60 * 1000)
      );

      // Calculate velocity metrics
      const velocityMetrics = this.calculateVelocityMetrics(salesHistory);

      // Apply seasonality adjustment if enabled
      let adjustedVelocity = velocityMetrics.averageDailyVelocity;
      if (config.seasonalityAdjustment) {
        adjustedVelocity = await this.applySeasonalityAdjustment(
          product,
          velocityMetrics
        );
      }

      // Include forecasting data if available and enabled
      let forecastInsight = null;
      if (config.includeForecasting) {
        forecastInsight = await this.getForecastInsight(product.product_id);
      }

      // Classify based on multiple factors
      const classification = this.classifyDeadStock(
        daysWithoutSale,
        adjustedVelocity,
        velocityMetrics,
        forecastInsight,
        config
      );

      // Only return analysis if product meets dead stock criteria
      if (classification !== "normal") {
        const analysis = this.createDeadStockAnalysis(
          product,
          {
            daysWithoutSale,
            velocityScore: adjustedVelocity * 100, // Convert to 0-100 scale
            classification,
            liquidationPriority: this.calculateLiquidationPriority(
              classification,
              product.current_stock_value,
              daysWithoutSale
            ),
            velocityMetrics,
            forecastInsight,
          },
          config
        );

        return analysis;
      }

      return null;
    } catch (error) {
      console.error(`Error analyzing product ${product.product_id}:`, error);
      throw error;
    }
  }

  /**
   * Calculate comprehensive velocity metrics
   */
  static calculateVelocityMetrics(salesHistory) {
    if (salesHistory.length === 0) {
      return {
        averageDailyVelocity: 0,
        maxDailyVelocity: 0,
        velocityVariability: 0,
        trenDirection: "declining",
        totalQuantitySold: 0,
      };
    }

    // Group sales by day
    const dailySales = {};
    let totalQuantity = 0;

    salesHistory.forEach((sale) => {
      const dateKey = sale.sale_date.toISOString().split("T")[0];
      dailySales[dateKey] = (dailySales[dateKey] || 0) + sale.quantity_sold;
      totalQuantity += sale.quantity_sold;
    });

    const salesValues = Object.values(dailySales);
    const daysCovered = Math.max(1, Object.keys(dailySales).length);

    // Calculate metrics
    const averageDailyVelocity = totalQuantity / daysCovered;
    const maxDailyVelocity = Math.max(...salesValues);
    const velocityVariability =
      this.calculateStandardDeviation(salesValues) / averageDailyVelocity;

    // Calculate trend direction
    const recentPeriod = salesValues.slice(-Math.min(7, salesValues.length));
    const earlierPeriod = salesValues.slice(0, Math.min(7, salesValues.length));
    const recentAvg =
      recentPeriod.reduce((sum, val) => sum + val, 0) / recentPeriod.length;
    const earlierAvg =
      earlierPeriod.reduce((sum, val) => sum + val, 0) / earlierPeriod.length;

    let trendDirection = "stable";
    if (recentAvg > earlierAvg * 1.1) trendDirection = "increasing";
    else if (recentAvg < earlierAvg * 0.9) trendDirection = "declining";

    return {
      averageDailyVelocity,
      maxDailyVelocity,
      velocityVariability: isNaN(velocityVariability) ? 0 : velocityVariability,
      trendDirection,
      totalQuantitySold: totalQuantity,
      daysCovered,
    };
  }

  /**
   * Apply seasonality adjustment to velocity calculations
   */
  static async applySeasonalityAdjustment(product, velocityMetrics) {
    try {
      // Get historical seasonal patterns (this is a simplified version)
      const currentMonth = new Date().getMonth() + 1;
      const currentQuarter = Math.ceil(currentMonth / 3);

      // Seasonal factors (these would ideally come from historical analysis)
      const seasonalFactors = {
        1: 0.8, // Q1 - Post-holiday slowdown
        2: 1.0, // Q2 - Normal
        3: 1.1, // Q3 - Back to school
        4: 1.3, // Q4 - Holiday season
      };

      // Category-specific adjustments (simplified)
      const categoryFactors = {
        electronics: { 1: 0.7, 2: 0.9, 3: 1.2, 4: 1.4 },
        clothing: { 1: 0.8, 2: 1.1, 3: 1.0, 4: 1.3 },
        toys: { 1: 0.6, 2: 0.8, 3: 1.0, 4: 1.8 },
      };

      const baseSeasonalFactor = seasonalFactors[currentQuarter] || 1.0;
      const categoryFactor =
        categoryFactors[product.category]?.[currentQuarter] ||
        baseSeasonalFactor;

      // Apply seasonal adjustment
      const adjustedVelocity =
        velocityMetrics.averageDailyVelocity / categoryFactor;

      return adjustedVelocity;
    } catch (error) {
      console.error("Error applying seasonality adjustment:", error);
      return velocityMetrics.averageDailyVelocity;
    }
  }

  /**
   * Get forecast insight for better dead stock detection
   */
  static async getForecastInsight(productId) {
    try {
      // Get recent forecast accuracy for this product
      const accuracyData = await ForecastAccuracy.findByProductId(
        productId,
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
        new Date()
      );

      if (accuracyData.length === 0) {
        return null;
      }

      const avgAccuracy =
        accuracyData.reduce((sum, acc) => sum + acc.accuracy_percentage, 0) /
        accuracyData.length;
      const avgPredictedDemand =
        accuracyData.reduce((sum, acc) => sum + acc.predicted_demand, 0) /
        accuracyData.length;
      const avgActualDemand =
        accuracyData.reduce((sum, acc) => sum + acc.actual_demand, 0) /
        accuracyData.length;

      return {
        forecastAccuracy: avgAccuracy,
        avgPredictedDemand,
        avgActualDemand,
        forecastTrend:
          avgPredictedDemand > avgActualDemand
            ? "overestimating"
            : "underestimating",
        confidenceLevel:
          avgAccuracy > 80 ? "high" : avgAccuracy > 60 ? "medium" : "low",
      };
    } catch (error) {
      console.error(
        `Error getting forecast insight for product ${productId}:`,
        error
      );
      return null;
    }
  }

  /**
   * Classify dead stock based on multiple factors
   */
  static classifyDeadStock(
    daysWithoutSale,
    adjustedVelocity,
    velocityMetrics,
    forecastInsight,
    config
  ) {
    // Base classification on days without sale
    let baseClassification = "normal";

    if (daysWithoutSale >= config.obsoleteDays) {
      baseClassification = "obsolete";
    } else if (daysWithoutSale >= config.deadStockDays) {
      baseClassification = "dead_stock";
    } else if (daysWithoutSale >= config.slowMovingDays) {
      baseClassification = "slow_moving";
    }

    // Adjust classification based on velocity
    if (
      adjustedVelocity < config.velocityThreshold &&
      daysWithoutSale >= config.slowMovingDays
    ) {
      if (baseClassification === "slow_moving") {
        baseClassification = "dead_stock";
      } else if (baseClassification === "dead_stock") {
        baseClassification = "obsolete";
      }
    }

    // Consider trend direction
    if (
      velocityMetrics.trendDirection === "declining" &&
      baseClassification === "slow_moving"
    ) {
      baseClassification = "dead_stock";
    }

    // Consider forecast insights
    if (forecastInsight) {
      if (
        forecastInsight.avgPredictedDemand < 1 &&
        forecastInsight.confidenceLevel === "high"
      ) {
        if (baseClassification === "slow_moving") {
          baseClassification = "dead_stock";
        }
      }
    }

    return baseClassification;
  }

  /**
   * Calculate liquidation priority (1-10, higher is more urgent)
   */
  static calculateLiquidationPriority(
    classification,
    stockValue,
    daysWithoutSale
  ) {
    let priority = 1;

    // Base priority on classification
    switch (classification) {
      case "obsolete":
        priority = 8;
        break;
      case "dead_stock":
        priority = 5;
        break;
      case "slow_moving":
        priority = 2;
        break;
    }

    // Adjust for stock value (higher value = higher priority)
    if (stockValue > 1000) priority += 2;
    else if (stockValue > 500) priority += 1;

    // Adjust for days without sale
    if (daysWithoutSale > 180) priority += 2;
    else if (daysWithoutSale > 120) priority += 1;

    return Math.min(10, priority);
  }

  /**
   * Create dead stock analysis object
   */
  static createDeadStockAnalysis(product, analysisData, config) {
    const suggestedDiscountPercentage = this.calculateSuggestedDiscount(
      analysisData.classification,
      analysisData.daysWithoutSale
    );

    const estimatedRecoveryValue =
      product.current_stock *
      product.selling_price *
      (1 - suggestedDiscountPercentage / 100);

    const clearanceRecommendation = this.generateClearanceRecommendation(
      analysisData.classification,
      product,
      analysisData
    );

    return {
      productId: product.product_id,
      daysWithoutSale: analysisData.daysWithoutSale,
      currentStockValue: product.current_stock * product.unit_cost,
      velocityScore: analysisData.velocityScore,
      deadStockClassification: analysisData.classification,
      liquidationPriority: analysisData.liquidationPriority,
      suggestedDiscountPercentage,
      estimatedRecoveryValue,
      clearanceRecommendation,
    };
  }

  /**
   * Calculate suggested discount percentage
   */
  static calculateSuggestedDiscount(classification, daysWithoutSale) {
    let baseDiscount = 0;

    switch (classification) {
      case "obsolete":
        baseDiscount = 50;
        break;
      case "dead_stock":
        baseDiscount = 25;
        break;
      case "slow_moving":
        baseDiscount = 10;
        break;
    }

    // Increase discount based on how long without sale
    if (daysWithoutSale > 180) baseDiscount += 20;
    else if (daysWithoutSale > 120) baseDiscount += 10;
    else if (daysWithoutSale > 90) baseDiscount += 5;

    return Math.min(70, baseDiscount); // Cap at 70% discount
  }

  /**
   * Generate actionable clearance recommendation
   */
  static generateClearanceRecommendation(
    classification,
    product,
    analysisData
  ) {
    const stockValue = product.current_stock * product.unit_cost;

    switch (classification) {
      case "obsolete":
        if (stockValue > 1000) {
          return `URGENT: High-value obsolete inventory. Consider bulk liquidation to wholesalers or return to supplier if possible. Current value: $${stockValue.toFixed(
            2
          )}`;
        } else {
          return `Liquidate immediately through clearance sale, donation (tax benefit), or employee purchase program. Set deep discount to move quickly.`;
        }

      case "dead_stock":
        if (product.category === "seasonal") {
          return `Plan for next season or liquidate now. Bundle with complementary items or create themed promotion packages.`;
        } else {
          return `Create targeted promotion or bundle with popular items. Consider online marketplace liquidation if in-store sales are slow.`;
        }

      case "slow_moving":
        return `Monitor for 2-4 weeks. Try repositioning in store, improved product placement, or small promotional discount before deeper liquidation.`;

      default:
        return "Continue monitoring sales performance.";
    }
  }

  /**
   * Generate comprehensive insights from dead stock analysis
   */
  static async generateDeadStockInsights(analysisResults, config) {
    const insights = {
      summary: {
        totalItems: analysisResults.length,
        totalValue: analysisResults.reduce(
          (sum, item) => sum + item.currentStockValue,
          0
        ),
        potentialRecovery: analysisResults.reduce(
          (sum, item) => sum + item.estimatedRecoveryValue,
          0
        ),
      },
      byClassification: {},
      recommendations: [],
      urgentActions: [],
    };

    // Group by classification
    analysisResults.forEach((item) => {
      if (!insights.byClassification[item.deadStockClassification]) {
        insights.byClassification[item.deadStockClassification] = {
          count: 0,
          totalValue: 0,
          avgDaysWithoutSale: 0,
        };
      }

      const category = insights.byClassification[item.deadStockClassification];
      category.count++;
      category.totalValue += item.currentStockValue;
      category.avgDaysWithoutSale += item.daysWithoutSale;
    });

    // Calculate averages
    Object.keys(insights.byClassification).forEach((classification) => {
      const category = insights.byClassification[classification];
      category.avgDaysWithoutSale =
        category.avgDaysWithoutSale / category.count;
    });

    // Generate recommendations
    if (insights.byClassification.obsolete?.count > 0) {
      insights.recommendations.push({
        type: "immediate_liquidation",
        priority: "high",
        description: `${
          insights.byClassification.obsolete.count
        } obsolete items worth $${insights.byClassification.obsolete.totalValue.toFixed(
          2
        )} need immediate attention`,
        action: "Initiate bulk liquidation process",
      });
    }

    if (insights.summary.totalValue > 10000) {
      insights.recommendations.push({
        type: "inventory_policy_review",
        priority: "medium",
        description: `High dead stock value ($${insights.summary.totalValue.toFixed(
          2
        )}) suggests inventory management policy review needed`,
        action: "Review purchasing patterns and demand forecasting accuracy",
      });
    }

    // Identify urgent actions
    const urgentItems = analysisResults.filter(
      (item) => item.liquidationPriority >= 8
    );
    insights.urgentActions = urgentItems.map((item) => ({
      productId: item.productId,
      priority: item.liquidationPriority,
      value: item.currentStockValue,
      daysWithoutSale: item.daysWithoutSale,
      recommendation: item.clearanceRecommendation,
    }));

    return insights;
  }

  /**
   * Get products with historical data for analysis
   */
  static async getProductsWithHistoricalData(storeId) {
    // This would be a complex query joining products, inventory, and sales
    // For now, we'll simulate getting the necessary data
    const query = `
      SELECT 
        p.product_id,
        p.product_name,
        p.sku,
        p.unit_cost,
        p.selling_price,
        p.category,
        COALESCE(i.current_stock, 0) as current_stock,
        COALESCE(i.current_stock * p.unit_cost, 0) as current_stock_value
      FROM products p
      LEFT JOIN inventory i ON p.product_id = i.product_id
      WHERE p.store_id = $1
        AND COALESCE(i.current_stock, 0) > 0
      ORDER BY current_stock_value DESC
    `;

    try {
      const result = await db.query(query, [storeId]);
      return result.rows;
    } catch (error) {
      console.error("Error getting products with historical data:", error);
      throw error;
    }
  }

  /**
   * Helper method to calculate standard deviation
   */
  static calculateStandardDeviation(values) {
    if (values.length === 0) return 0;

    const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map((val) => Math.pow(val - avg, 2));
    const avgSquaredDiff =
      squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;

    return Math.sqrt(avgSquaredDiff);
  }

  /**
   * Calculate velocity score for a product
   */
  static async calculateVelocity(productId, windowDays = 30) {
    try {
      const result = await db.query(
        `
        SELECT 
          COALESCE(SUM(quantity_sold), 0) as total_quantity,
          COUNT(DISTINCT DATE(sale_date)) as active_days,
          AVG(quantity_sold) as avg_daily_sales
        FROM sales 
        WHERE product_id = $1 
        AND sale_date >= CURRENT_DATE - INTERVAL '${windowDays} days'
      `,
        [productId]
      );

      const stats = result.rows[0];
      const velocity = parseFloat(stats.total_quantity) / windowDays;

      return {
        velocity,
        totalQuantity: parseInt(stats.total_quantity) || 0,
        activeDays: parseInt(stats.active_days) || 0,
        avgDailySales: parseFloat(stats.avg_daily_sales) || 0,
        windowDays
      };
    } catch (error) {
      throw new Error(`Failed to calculate velocity: ${error.message}`);
    }
  }

  /**
   * Analyze dead stock trends over time
   */
  static async analyzeDeadStockTrends(storeId, period = "12 months") {
    try {
      const result = await db.query(
        `
        WITH monthly_dead_stock AS (
          SELECT 
            DATE_TRUNC('month', created_at) as month,
            COUNT(*) as dead_stock_count,
            SUM(inventory_value) as dead_stock_value
          FROM dead_stock_analysis
          WHERE store_id = $1
          AND created_at >= CURRENT_DATE - INTERVAL '${period}'
          AND risk_level IN ('dead_stock', 'obsolete')
          GROUP BY DATE_TRUNC('month', created_at)
          ORDER BY month
        )
        SELECT 
          month,
          dead_stock_count,
          dead_stock_value,
          LAG(dead_stock_count) OVER (ORDER BY month) as prev_count,
          LAG(dead_stock_value) OVER (ORDER BY month) as prev_value
        FROM monthly_dead_stock
      `,
        [storeId]
      );

      return result.rows.map(row => ({
        month: row.month,
        deadStockCount: parseInt(row.dead_stock_count),
        deadStockValue: parseFloat(row.dead_stock_value),
        countTrend: row.prev_count 
          ? (parseInt(row.dead_stock_count) - parseInt(row.prev_count)) / parseInt(row.prev_count) * 100
          : 0,
        valueTrend: row.prev_value
          ? (parseFloat(row.dead_stock_value) - parseFloat(row.prev_value)) / parseFloat(row.prev_value) * 100
          : 0
      }));
    } catch (error) {
      throw new Error(`Failed to analyze dead stock trends: ${error.message}`);
    }
  }

  /**
   * Get liquidation candidates based on urgency
   */
  static async getLiquidationCandidates(storeId, urgencyThreshold = 0.8) {
    try {
      const result = await db.query(
        `
        SELECT 
          p.product_id,
          p.product_name,
          p.sku,
          i.current_stock,
          p.unit_cost,
          i.current_stock * p.unit_cost as inventory_value,
          dsa.risk_score,
          dsa.days_without_sales,
          dsa.velocity_score,
          dsa.recommendation
        FROM dead_stock_analysis dsa
        JOIN products p ON dsa.product_id = p.product_id
        JOIN inventory i ON p.product_id = i.product_id
        WHERE dsa.store_id = $1
        AND dsa.risk_score >= $2
        AND dsa.risk_level IN ('dead_stock', 'obsolete')
        ORDER BY dsa.risk_score DESC, inventory_value DESC
      `,
        [storeId, urgencyThreshold]
      );

      return result.rows.map(row => ({
        productId: row.product_id,
        productName: row.product_name,
        sku: row.sku,
        currentStock: parseInt(row.current_stock),
        unitCost: parseFloat(row.unit_cost),
        inventoryValue: parseFloat(row.inventory_value),
        riskScore: parseFloat(row.risk_score),
        daysWithoutSales: parseInt(row.days_without_sales),
        velocityScore: parseFloat(row.velocity_score),
        recommendation: row.recommendation
      }));
    } catch (error) {
      throw new Error(`Failed to get liquidation candidates: ${error.message}`);
    }
  }

  /**
   * Calculate financial impact of liquidation
   */
  static async calculateLiquidationImpact(storeId) {
    try {
      const result = await db.query(
        `
        SELECT 
          COUNT(*) as total_products,
          SUM(i.current_stock * p.unit_cost) as total_inventory_value,
          SUM(CASE WHEN dsa.risk_level = 'dead_stock' THEN i.current_stock * p.unit_cost ELSE 0 END) as dead_stock_value,
          SUM(CASE WHEN dsa.risk_level = 'obsolete' THEN i.current_stock * p.unit_cost ELSE 0 END) as obsolete_value,
          AVG(dsa.risk_score) as avg_risk_score
        FROM dead_stock_analysis dsa
        JOIN products p ON dsa.product_id = p.product_id
        JOIN inventory i ON p.product_id = i.product_id
        WHERE dsa.store_id = $1
        AND dsa.risk_level IN ('dead_stock', 'obsolete')
      `,
        [storeId]
      );

      const stats = result.rows[0];
      const totalValue = parseFloat(stats.total_inventory_value) || 0;
      const deadStockValue = parseFloat(stats.dead_stock_value) || 0;
      const obsoleteValue = parseFloat(stats.obsolete_value) || 0;

      return {
        totalProducts: parseInt(stats.total_products) || 0,
        totalInventoryValue: totalValue,
        deadStockValue,
        obsoleteValue,
        liquidationValue: deadStockValue + obsoleteValue,
        percentageOfInventory: totalValue > 0 ? ((deadStockValue + obsoleteValue) / totalValue) * 100 : 0,
        avgRiskScore: parseFloat(stats.avg_risk_score) || 0,
        estimatedLoss: (deadStockValue + obsoleteValue) * 0.7, // Assume 30% recovery rate
        potentialSavings: (deadStockValue + obsoleteValue) * 0.15 // Storage cost savings
      };
    } catch (error) {
      throw new Error(`Failed to calculate liquidation impact: ${error.message}`);
    }
  }
}

module.exports = DeadStockDetectionService;
