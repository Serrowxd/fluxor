const Forecast = require("../models/Forecast");
const ForecastAccuracy = require("../models/ForecastAccuracy");
const DeadStockAnalysis = require("../models/DeadStockAnalysis");
const Sale = require("../models/Sale");
const Store = require("../models/Store");
const ExternalFactors = require("../models/ExternalFactors");

class ForecastAccuracyService {
  /**
   * Update forecast accuracy for all stores
   */
  static async updateAllForecastAccuracy() {
    try {
      console.log("Starting forecast accuracy update...");

      const stores = await Store.findAll();
      let totalUpdated = 0;

      for (const store of stores) {
        try {
          const updated = await this.updateForecastAccuracyForStore(
            store.store_id
          );
          totalUpdated += updated;
          console.log(
            `Updated ${updated} forecasts for store ${store.store_id}`
          );
        } catch (error) {
          console.error(
            `Error updating forecasts for store ${store.store_id}:`,
            error
          );
        }
      }

      console.log(
        `Forecast accuracy update completed. Total updated: ${totalUpdated}`
      );
      return totalUpdated;
    } catch (error) {
      console.error("Error in updateAllForecastAccuracy:", error);
      throw error;
    }
  }

  /**
   * Update forecast accuracy for a specific store
   */
  static async updateForecastAccuracyForStore(storeId) {
    try {
      // Get forecasts that need accuracy updates (past 7 days)
      const forecastsNeedingUpdate =
        await Forecast.getForecastsNeedingAccuracyUpdate(storeId, 7);

      let updatedCount = 0;

      for (const forecast of forecastsNeedingUpdate) {
        try {
          await Forecast.updateForecastAccuracy(
            forecast.product_id,
            forecast.forecast_date,
            forecast.actual_demand
          );
          updatedCount++;
        } catch (error) {
          console.error(
            `Error updating accuracy for forecast ${forecast.forecast_id}:`,
            error
          );
        }
      }

      return updatedCount;
    } catch (error) {
      console.error(
        `Error updating forecast accuracy for store ${storeId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Generate accuracy metrics for all stores
   */
  static async generateAccuracyMetrics() {
    try {
      console.log("Generating accuracy metrics...");

      const stores = await Store.findAll();
      const results = [];

      for (const store of stores) {
        try {
          const metrics = await this.generateAccuracyMetricsForStore(
            store.store_id
          );
          results.push({
            storeId: store.store_id,
            metrics,
          });
        } catch (error) {
          console.error(
            `Error generating metrics for store ${store.store_id}:`,
            error
          );
          results.push({
            storeId: store.store_id,
            error: error.message,
          });
        }
      }

      console.log("Accuracy metrics generation completed");
      return results;
    } catch (error) {
      console.error("Error in generateAccuracyMetrics:", error);
      throw error;
    }
  }

  /**
   * Generate accuracy metrics for a specific store
   */
  static async generateAccuracyMetricsForStore(storeId) {
    try {
      // Calculate weekly metrics
      const weeklyMetrics = await ForecastAccuracy.getStoreAccuracyMetrics(
        storeId,
        "weekly"
      );

      // Calculate monthly metrics
      const monthlyMetrics = await ForecastAccuracy.getStoreAccuracyMetrics(
        storeId,
        "monthly"
      );

      // Get model comparison
      const modelComparison = await ForecastAccuracy.getModelComparison(
        null,
        null,
        null
      );

      // Get products needing attention
      const attentionNeeded =
        await ForecastAccuracy.getProductsNeedingAttention(storeId, 70, 5);

      return {
        weekly: weeklyMetrics,
        monthly: monthlyMetrics,
        modelComparison,
        attentionNeeded: attentionNeeded.length,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(
        `Error generating accuracy metrics for store ${storeId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Run dead stock analysis for all stores
   */
  static async runDeadStockAnalysisForAllStores() {
    try {
      console.log("Starting dead stock analysis for all stores...");

      const stores = await Store.findAll();
      const results = [];

      for (const store of stores) {
        try {
          const analysis = await this.runDeadStockAnalysisForStore(
            store.store_id
          );
          results.push({
            storeId: store.store_id,
            analysis,
          });
        } catch (error) {
          console.error(
            `Error running dead stock analysis for store ${store.store_id}:`,
            error
          );
          results.push({
            storeId: store.store_id,
            error: error.message,
          });
        }
      }

      console.log("Dead stock analysis completed for all stores");
      return results;
    } catch (error) {
      console.error("Error in runDeadStockAnalysisForAllStores:", error);
      throw error;
    }
  }

  /**
   * Run dead stock analysis for a specific store
   */
  static async runDeadStockAnalysisForStore(storeId, config = {}) {
    try {
      const defaultConfig = {
        slowMovingDays: 30,
        deadStockDays: 60,
        obsoleteDays: 90,
        minStockValue: 0,
      };

      const analysisConfig = { ...defaultConfig, ...config };

      // Run dead stock analysis
      const analysisResults = await DeadStockAnalysis.analyzeDeadStock(
        storeId,
        analysisConfig
      );

      // Save analysis results to database
      const savedResults = [];
      for (const result of analysisResults) {
        try {
          const saved = await DeadStockAnalysis.create(result);
          savedResults.push(saved);
        } catch (error) {
          console.error(
            `Error saving dead stock analysis for product ${result.productId}:`,
            error
          );
        }
      }

      // Generate summary statistics
      const summary = await DeadStockAnalysis.getSummaryStats(storeId);

      return {
        analyzedProducts: analysisResults.length,
        savedResults: savedResults.length,
        summary,
        config: analysisConfig,
        analyzedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(
        `Error running dead stock analysis for store ${storeId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Clean up old forecast accuracy records
   */
  static async cleanupOldRecords() {
    try {
      console.log("Cleaning up old forecast accuracy records...");

      // Delete forecast accuracy records older than 1 year
      const deletedAccuracy = await ForecastAccuracy.deleteOldRecords(365);

      // Delete dead stock analysis records older than 6 months
      const deletedDeadStock = await DeadStockAnalysis.deleteOldAnalysis(180);

      // Delete old forecasts
      const deletedForecasts = await Forecast.deleteOldForecasts(90);

      // Delete old external factors
      const deletedFactors = await ExternalFactors.deleteOldFactors(730);

      console.log(`Cleanup completed:
        - Deleted ${deletedAccuracy.length} accuracy records
        - Deleted ${deletedDeadStock.length} dead stock analysis records
        - Deleted ${deletedForecasts.length} forecast records
        - Deleted ${deletedFactors.length} external factor records`);

      return {
        deletedAccuracy: deletedAccuracy.length,
        deletedDeadStock: deletedDeadStock.length,
        deletedForecasts: deletedForecasts.length,
        deletedFactors: deletedFactors.length,
      };
    } catch (error) {
      console.error("Error in cleanupOldRecords:", error);
      throw error;
    }
  }

  /**
   * Generate forecast improvement recommendations
   */
  static async generateImprovementRecommendations(storeId) {
    try {
      const recommendations = [];

      // Get products with low accuracy
      const lowAccuracyProducts =
        await ForecastAccuracy.getProductsNeedingAttention(storeId, 70, 5);

      if (lowAccuracyProducts.length > 0) {
        recommendations.push({
          type: "accuracy_improvement",
          priority: "high",
          title: "Products with Low Forecast Accuracy",
          description: `${lowAccuracyProducts.length} products have forecast accuracy below 70%`,
          action:
            "Review and adjust forecasting parameters, consider adding external factors",
          affectedProducts: lowAccuracyProducts.length,
          products: lowAccuracyProducts.slice(0, 5), // Include top 5 for details
        });
      }

      // Get model performance comparison
      const modelComparison = await ForecastAccuracy.getModelComparison(
        null,
        null,
        null
      );
      const propheuModel = modelComparison.find(
        (m) => m.model_used === "prophet"
      );
      const movingAvgModel = modelComparison.find(
        (m) => m.model_used === "moving_average"
      );

      if (
        propheuModel &&
        movingAvgModel &&
        propheuModel.avg_accuracy < movingAvgModel.avg_accuracy
      ) {
        recommendations.push({
          type: "model_optimization",
          priority: "medium",
          title: "Prophet Model Underperforming",
          description:
            "Prophet model is performing worse than moving average fallback",
          action:
            "Review Prophet model parameters, check for sufficient training data",
          prophetAccuracy: propheuModel.avg_accuracy,
          movingAvgAccuracy: movingAvgModel.avg_accuracy,
        });
      }

      // Check for dead stock issues
      const deadStockSummary = await DeadStockAnalysis.getSummaryStats(storeId);

      if (deadStockSummary && deadStockSummary.obsolete_count > 0) {
        recommendations.push({
          type: "dead_stock_action",
          priority: "high",
          title: "Obsolete Inventory Detected",
          description: `${deadStockSummary.obsolete_count} products classified as obsolete`,
          action: "Immediate liquidation recommended to recover value",
          obsoleteCount: deadStockSummary.obsolete_count,
          potentialLoss: deadStockSummary.total_potential_loss,
        });
      }

      if (
        deadStockSummary &&
        deadStockSummary.slow_moving_count >
          deadStockSummary.total_products_analyzed * 0.3
      ) {
        recommendations.push({
          type: "inventory_optimization",
          priority: "medium",
          title: "High Percentage of Slow-Moving Inventory",
          description: `${Math.round(
            (deadStockSummary.slow_moving_count /
              deadStockSummary.total_products_analyzed) *
              100
          )}% of inventory is slow-moving`,
          action: "Review purchasing patterns and demand forecasting accuracy",
          slowMovingPercentage: Math.round(
            (deadStockSummary.slow_moving_count /
              deadStockSummary.total_products_analyzed) *
              100
          ),
        });
      }

      // Check seasonal factors utilization
      const seasonalFactors = await ExternalFactors.getSeasonalFactors(storeId);

      if (seasonalFactors.length === 0) {
        recommendations.push({
          type: "external_factors",
          priority: "low",
          title: "No External Factors Configured",
          description:
            "Adding seasonal and holiday factors could improve forecast accuracy",
          action:
            "Configure external factors for holidays, promotions, and seasonal events",
          potentialImprovement: "5-15% accuracy increase",
        });
      }

      return recommendations;
    } catch (error) {
      console.error(
        `Error generating improvement recommendations for store ${storeId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Schedule all periodic tasks
   */
  static initializeScheduledTasks() {
    // Update forecast accuracy daily at 2 AM
    setInterval(async () => {
      try {
        await this.updateAllForecastAccuracy();
      } catch (error) {
        console.error("Scheduled forecast accuracy update failed:", error);
      }
    }, 24 * 60 * 60 * 1000); // 24 hours

    // Run dead stock analysis weekly on Sundays at 3 AM
    setInterval(async () => {
      const now = new Date();
      if (now.getDay() === 0 && now.getHours() === 3) {
        // Sunday at 3 AM
        try {
          await this.runDeadStockAnalysisForAllStores();
        } catch (error) {
          console.error("Scheduled dead stock analysis failed:", error);
        }
      }
    }, 60 * 60 * 1000); // Check every hour

    // Cleanup old records monthly on the 1st at 4 AM
    setInterval(async () => {
      const now = new Date();
      if (now.getDate() === 1 && now.getHours() === 4) {
        // 1st of month at 4 AM
        try {
          await this.cleanupOldRecords();
        } catch (error) {
          console.error("Scheduled cleanup failed:", error);
        }
      }
    }, 60 * 60 * 1000); // Check every hour

    console.log("Forecast accuracy service scheduled tasks initialized");
  }
}

module.exports = ForecastAccuracyService;
