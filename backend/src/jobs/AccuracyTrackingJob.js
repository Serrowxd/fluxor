const ForecastAccuracyService = require("../services/ForecastAccuracyService");
const ForecastAccuracy = require("../models/ForecastAccuracy");
const Forecast = require("../models/Forecast");
const Sale = require("../models/Sale");
const Store = require("../models/Store");
const axios = require("axios");

class AccuracyTrackingJob {
  /**
   * Main job to run accuracy tracking
   */
  static async run() {
    try {
      console.log("Starting accuracy tracking job...");

      // Update forecast accuracy for all stores
      const updatedCount =
        await ForecastAccuracyService.updateAllForecastAccuracy();

      // Generate accuracy metrics
      const metricsResults =
        await ForecastAccuracyService.generateAccuracyMetrics();

      // Calculate overall accuracy improvement recommendations
      const stores = await Store.findAll();
      const recommendations = [];

      for (const store of stores) {
        try {
          const storeRecommendations =
            await ForecastAccuracyService.generateImprovementRecommendations(
              store.store_id
            );
          recommendations.push({
            storeId: store.store_id,
            recommendations: storeRecommendations,
          });
        } catch (error) {
          console.error(
            `Error generating recommendations for store ${store.store_id}:`,
            error
          );
        }
      }

      // Log job completion
      console.log(`Accuracy tracking job completed:
        - Updated ${updatedCount} forecasts
        - Generated metrics for ${metricsResults.length} stores
        - Generated recommendations for ${recommendations.length} stores`);

      return {
        success: true,
        updatedForecasts: updatedCount,
        storesProcessed: metricsResults.length,
        recommendationsGenerated: recommendations.length,
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error("Accuracy tracking job failed:", error);
      throw error;
    }
  }

  /**
   * Job to compare forecast accuracy across different models
   */
  static async runModelComparisonAnalysis() {
    try {
      console.log("Starting model comparison analysis...");

      const stores = await Store.findAll();
      const comparisonResults = [];

      for (const store of stores) {
        try {
          // Get model comparison for the store
          const modelComparison = await ForecastAccuracy.getModelComparison(
            null,
            null,
            null
          );

          // Analyze model performance trends
          const weeklyMetrics = await ForecastAccuracy.getStoreAccuracyMetrics(
            store.store_id,
            "weekly"
          );
          const monthlyMetrics = await ForecastAccuracy.getStoreAccuracyMetrics(
            store.store_id,
            "monthly"
          );

          // Identify best performing model
          const bestModel = modelComparison.reduce((best, current) =>
            current.avg_accuracy > best.avg_accuracy ? current : best
          );

          // Check if model switching recommendation is needed
          const modelSwitchRecommended =
            this.shouldRecommendModelSwitch(modelComparison);

          comparisonResults.push({
            storeId: store.store_id,
            modelComparison,
            bestModel: bestModel.model_used,
            bestModelAccuracy: bestModel.avg_accuracy,
            weeklyTrend: this.calculateTrend(weeklyMetrics),
            monthlyTrend: this.calculateTrend(monthlyMetrics),
            modelSwitchRecommended,
            analyzedAt: new Date().toISOString(),
          });
        } catch (error) {
          console.error(
            `Error analyzing models for store ${store.store_id}:`,
            error
          );
        }
      }

      console.log(
        `Model comparison analysis completed for ${comparisonResults.length} stores`
      );
      return comparisonResults;
    } catch (error) {
      console.error("Model comparison analysis failed:", error);
      throw error;
    }
  }

  /**
   * Job to validate forecast accuracy and retrain models if needed
   */
  static async runModelValidationAndRetraining() {
    try {
      console.log("Starting model validation and retraining job...");

      const stores = await Store.findAll();
      const retrainingResults = [];

      for (const store of stores) {
        try {
          // Get products with low accuracy that might need retraining
          const lowAccuracyProducts =
            await ForecastAccuracy.getProductsNeedingAttention(
              store.store_id,
              60,
              10
            );

          for (const product of lowAccuracyProducts) {
            try {
              // Check if product has enough new data for retraining
              const recentSales = await Sale.findByProductId(
                product.product_id,
                new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
                new Date()
              );

              if (recentSales.length >= 7) {
                // At least 7 days of new data
                // Trigger retraining by calling forecast service
                const salesData = recentSales.map((sale) => ({
                  ds: sale.sale_date,
                  y: sale.quantity_sold,
                }));

                try {
                  const response = await axios.post(
                    process.env.AI_SERVICE_URL + "/forecast",
                    {
                      product_id: product.product_id,
                      sales_data: salesData,
                      forecast_horizon: 30,
                      multi_step: false,
                    }
                  );

                  if (response.data && response.data.forecasts) {
                    // Save new forecasts
                    const forecastsToSave = response.data.forecasts.map(
                      (forecast) => ({
                        productId: product.product_id,
                        forecastDate: forecast.date,
                        predictedDemand: forecast.predicted_demand,
                        confidenceLevel: response.data.confidence_level,
                        modelUsed: response.data.model_used || "prophet",
                      })
                    );

                    await Forecast.bulkCreate(forecastsToSave);

                    retrainingResults.push({
                      productId: product.product_id,
                      status: "retrained",
                      previousAccuracy: product.avg_accuracy,
                      newConfidenceLevel: response.data.confidence_level,
                      newForecastsGenerated: forecastsToSave.length,
                    });
                  }
                } catch (forecastError) {
                  console.error(
                    `Error retraining model for product ${product.product_id}:`,
                    forecastError
                  );
                  retrainingResults.push({
                    productId: product.product_id,
                    status: "failed",
                    error: forecastError.message,
                  });
                }
              } else {
                retrainingResults.push({
                  productId: product.product_id,
                  status: "insufficient_data",
                  recentSalesCount: recentSales.length,
                });
              }
            } catch (error) {
              console.error(
                `Error processing product ${product.product_id} for retraining:`,
                error
              );
            }
          }
        } catch (error) {
          console.error(
            `Error validating models for store ${store.store_id}:`,
            error
          );
        }
      }

      console.log(`Model validation and retraining completed:
        - Processed ${retrainingResults.length} products
        - Successfully retrained ${
          retrainingResults.filter((r) => r.status === "retrained").length
        } models`);

      return retrainingResults;
    } catch (error) {
      console.error("Model validation and retraining job failed:", error);
      throw error;
    }
  }

  /**
   * Job to generate accuracy reports and send alerts
   */
  static async runAccuracyReporting() {
    try {
      console.log("Starting accuracy reporting job...");

      const stores = await Store.findAll();
      const reports = [];

      for (const store of stores) {
        try {
          // Generate comprehensive accuracy report
          const weeklyMetrics = await ForecastAccuracy.getStoreAccuracyMetrics(
            store.store_id,
            "weekly"
          );
          const monthlyMetrics = await ForecastAccuracy.getStoreAccuracyMetrics(
            store.store_id,
            "monthly"
          );
          const modelComparison = await ForecastAccuracy.getModelComparison(
            null,
            null,
            null
          );
          const lowAccuracyProducts =
            await ForecastAccuracy.getProductsNeedingAttention(
              store.store_id,
              70,
              5
            );

          // Calculate key metrics
          const avgWeeklyAccuracy =
            weeklyMetrics.reduce(
              (sum, metric) => sum + metric.avg_accuracy,
              0
            ) / weeklyMetrics.length;
          const avgMonthlyAccuracy =
            monthlyMetrics.reduce(
              (sum, metric) => sum + metric.avg_accuracy,
              0
            ) / monthlyMetrics.length;

          // Determine accuracy trend
          const trend =
            weeklyMetrics.length >= 2
              ? weeklyMetrics[0].avg_accuracy > weeklyMetrics[1].avg_accuracy
                ? "improving"
                : "declining"
              : "stable";

          const report = {
            storeId: store.store_id,
            reportDate: new Date().toISOString(),
            accuracyMetrics: {
              weeklyAverage: avgWeeklyAccuracy,
              monthlyAverage: avgMonthlyAccuracy,
              trend,
              lowAccuracyProductsCount: lowAccuracyProducts.length,
            },
            modelPerformance: modelComparison,
            recommendations:
              await ForecastAccuracyService.generateImprovementRecommendations(
                store.store_id
              ),
            dataQuality: {
              weeklyDataPoints: weeklyMetrics.reduce(
                (sum, metric) => sum + metric.verified_forecasts,
                0
              ),
              monthlyDataPoints: monthlyMetrics.reduce(
                (sum, metric) => sum + metric.verified_forecasts,
                0
              ),
            },
          };

          reports.push(report);

          // Send alerts for critical accuracy issues
          if (avgWeeklyAccuracy < 60 || lowAccuracyProducts.length > 10) {
            await this.sendAccuracyAlert(store, report);
          }
        } catch (error) {
          console.error(
            `Error generating accuracy report for store ${store.store_id}:`,
            error
          );
        }
      }

      console.log(`Accuracy reporting completed for ${reports.length} stores`);
      return reports;
    } catch (error) {
      console.error("Accuracy reporting job failed:", error);
      throw error;
    }
  }

  /**
   * Helper method to calculate trend from metrics
   */
  static calculateTrend(metrics) {
    if (metrics.length < 2) return "insufficient_data";

    const recent = metrics.slice(0, Math.min(4, metrics.length));
    const older = metrics.slice(-Math.min(4, metrics.length));

    const recentAvg =
      recent.reduce((sum, m) => sum + m.avg_accuracy, 0) / recent.length;
    const olderAvg =
      older.reduce((sum, m) => sum + m.avg_accuracy, 0) / older.length;

    const difference = recentAvg - olderAvg;

    if (difference > 5) return "improving";
    if (difference < -5) return "declining";
    return "stable";
  }

  /**
   * Helper method to determine if model switching should be recommended
   */
  static shouldRecommendModelSwitch(modelComparison) {
    if (modelComparison.length < 2) return false;

    const prophetModel = modelComparison.find(
      (m) => m.model_used === "prophet"
    );
    const movingAvgModel = modelComparison.find(
      (m) => m.model_used === "moving_average"
    );

    if (!prophetModel || !movingAvgModel) return false;

    // Recommend switch if moving average significantly outperforms Prophet
    return movingAvgModel.avg_accuracy > prophetModel.avg_accuracy + 10;
  }

  /**
   * Helper method to send accuracy alerts
   */
  static async sendAccuracyAlert(store, report) {
    try {
      // This would integrate with your notification system
      console.log(`ACCURACY ALERT for store ${store.store_id}:
        - Weekly accuracy: ${report.accuracyMetrics.weeklyAverage.toFixed(2)}%
        - Products needing attention: ${
          report.accuracyMetrics.lowAccuracyProductsCount
        }
        - Trend: ${report.accuracyMetrics.trend}`);

      // Here you would send email, Slack notification, etc.
      // await NotificationService.sendAlert({
      //   type: 'forecast_accuracy',
      //   storeId: store.store_id,
      //   severity: report.accuracyMetrics.weeklyAverage < 50 ? 'critical' : 'warning',
      //   data: report
      // });
    } catch (error) {
      console.error(
        `Error sending accuracy alert for store ${store.store_id}:`,
        error
      );
    }
  }
}

module.exports = AccuracyTrackingJob;
