const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth");
const Forecast = require("../models/Forecast");
const ForecastAccuracy = require("../models/ForecastAccuracy");
const DeadStockAnalysis = require("../models/DeadStockAnalysis");
const ExternalFactors = require("../models/ExternalFactors");
const Sale = require("../models/Sale");
const Product = require("../models/Product");
const axios = require("axios");

// Get forecasts for a store
router.get("/", authenticateToken, async (req, res) => {
  try {
    const { user } = req;
    const { startDate, endDate, productId } = req.query;

    let forecasts;
    if (productId) {
      forecasts = await Forecast.findByProductId(productId, startDate, endDate);
    } else {
      forecasts = await Forecast.getLatestForecasts(user.storeId, 30);
    }

    res.json({ forecasts });
  } catch (error) {
    console.error("Error fetching forecasts:", error);
    res.status(500).json({ error: "Failed to fetch forecasts" });
  }
});

// Get forecasts with accuracy data
router.get("/with-accuracy", authenticateToken, async (req, res) => {
  try {
    const { user } = req;
    const { startDate, endDate } = req.query;

    const forecasts = await Forecast.getForecastsWithAccuracy(
      user.storeId,
      startDate,
      endDate
    );

    res.json({ forecasts });
  } catch (error) {
    console.error("Error fetching forecasts with accuracy:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch forecasts with accuracy data" });
  }
});

// Get multi-step ahead forecasts
router.get("/multi-step", authenticateToken, async (req, res) => {
  try {
    const { user } = req;
    const { productId } = req.query;

    const forecasts = await Forecast.getMultiStepForecasts(
      user.storeId,
      productId
    );

    res.json({ forecasts });
  } catch (error) {
    console.error("Error fetching multi-step forecasts:", error);
    res.status(500).json({ error: "Failed to fetch multi-step forecasts" });
  }
});

// Run forecast generation
router.post("/run", authenticateToken, async (req, res) => {
  try {
    const { user } = req;
    const {
      productIds,
      forecastHorizon = 30,
      includeExternalFactors = false,
    } = req.body;

    // Get products to forecast
    const products = productIds || (await Product.findByStoreId(user.storeId));

    const forecastResults = [];

    for (const productId of products) {
      try {
        // Get sales data for the product
        const salesData = await Sale.getAggregatedSales(
          productId,
          "day",
          null,
          null
        );

        if (salesData.length < 7) {
          console.log(`Insufficient sales data for product ${productId}`);
          continue;
        }

        // Format sales data for Prophet
        const formattedSalesData = salesData.map((sale) => ({
          ds: sale.period,
          y: sale.total_quantity,
        }));

        // Get external factors if requested
        let externalFactors = [];
        if (includeExternalFactors) {
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - 90);
          const endDate = new Date();
          endDate.setDate(endDate.getDate() + forecastHorizon);

          externalFactors = await ExternalFactors.getFactorsForProduct(
            productId,
            startDate.toISOString().split("T")[0],
            endDate.toISOString().split("T")[0]
          );
        }

        // Call Prophet microservice
        const response = await axios.post(
          process.env.AI_SERVICE_URL + "/forecast",
          {
            product_id: productId,
            sales_data: formattedSalesData,
            external_factors: externalFactors,
            forecast_horizon: forecastHorizon,
            multi_step: false,
          }
        );

        if (response.data && response.data.forecasts) {
          // Save forecasts to database
          const forecastsToSave = response.data.forecasts.map((forecast) => ({
            productId,
            forecastDate: forecast.date,
            predictedDemand: forecast.predicted_demand,
            confidenceLevel: response.data.confidence_level,
            modelUsed: response.data.model_used || "prophet",
            upperBound: forecast.upper_bound,
            lowerBound: forecast.lower_bound,
          }));

          await Forecast.bulkCreate(forecastsToSave);
          forecastResults.push({
            productId,
            status: "success",
            forecastsGenerated: forecastsToSave.length,
            confidenceLevel: response.data.confidence_level,
            dataQualityScore: response.data.data_quality_score,
          });
        }
      } catch (error) {
        console.error(`Error forecasting for product ${productId}:`, error);
        forecastResults.push({
          productId,
          status: "error",
          error: error.message,
        });
      }
    }

    res.json({
      success: true,
      message: "Forecast generation completed",
      results: forecastResults,
    });
  } catch (error) {
    console.error("Error running forecast:", error);
    res.status(500).json({ error: "Failed to run forecast generation" });
  }
});

// Forecast accuracy endpoints
router.get("/accuracy", authenticateToken, async (req, res) => {
  try {
    const { user } = req;
    const { productId, startDate, endDate, timePeriod = "monthly" } = req.query;

    let accuracyMetrics;
    if (productId) {
      accuracyMetrics = await ForecastAccuracy.getAccuracyMetrics(
        productId,
        timePeriod,
        startDate,
        endDate
      );
    } else {
      accuracyMetrics = await ForecastAccuracy.getStoreAccuracyMetrics(
        user.storeId,
        timePeriod,
        startDate,
        endDate
      );
    }

    res.json({ accuracyMetrics });
  } catch (error) {
    console.error("Error fetching accuracy metrics:", error);
    res.status(500).json({ error: "Failed to fetch accuracy metrics" });
  }
});

// Get model performance comparison
router.get(
  "/accuracy/model-comparison",
  authenticateToken,
  async (req, res) => {
    try {
      const { productId, startDate, endDate } = req.query;

      const modelComparison = await ForecastAccuracy.getModelComparison(
        productId,
        startDate,
        endDate
      );

      res.json({ modelComparison });
    } catch (error) {
      console.error("Error fetching model comparison:", error);
      res.status(500).json({ error: "Failed to fetch model comparison" });
    }
  }
);

// Get products needing forecast attention
router.get(
  "/accuracy/attention-needed",
  authenticateToken,
  async (req, res) => {
    try {
      const { user } = req;
      const { accuracyThreshold = 70, minForecasts = 5 } = req.query;

      const products = await ForecastAccuracy.getProductsNeedingAttention(
        user.storeId,
        parseFloat(accuracyThreshold),
        parseInt(minForecasts)
      );

      res.json({ products });
    } catch (error) {
      console.error("Error fetching products needing attention:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch products needing attention" });
    }
  }
);

// Update forecast accuracy with actual sales
router.post("/accuracy/update", authenticateToken, async (req, res) => {
  try {
    const { user } = req;

    // Get forecasts that need accuracy updates
    const forecastsNeedingUpdate =
      await Forecast.getForecastsNeedingAccuracyUpdate(user.storeId, 7);

    const updatedCount = forecastsNeedingUpdate.length;

    // Update each forecast with actual sales data
    for (const forecast of forecastsNeedingUpdate) {
      await Forecast.updateForecastAccuracy(
        forecast.product_id,
        forecast.forecast_date,
        forecast.actual_demand
      );
    }

    res.json({
      success: true,
      message: `Updated accuracy for ${updatedCount} forecasts`,
      updatedCount,
    });
  } catch (error) {
    console.error("Error updating forecast accuracy:", error);
    res.status(500).json({ error: "Failed to update forecast accuracy" });
  }
});

// Dead stock analysis endpoints
router.get("/dead-stock", authenticateToken, async (req, res) => {
  try {
    const { user } = req;
    const { analysisDate, classification } = req.query;

    const deadStockAnalysis = await DeadStockAnalysis.getStoreDeadStockAnalysis(
      user.storeId,
      analysisDate,
      classification
    );

    res.json({ deadStockAnalysis });
  } catch (error) {
    console.error("Error fetching dead stock analysis:", error);
    res.status(500).json({ error: "Failed to fetch dead stock analysis" });
  }
});

// Run dead stock analysis
router.post("/dead-stock/analyze", authenticateToken, async (req, res) => {
  try {
    const { user } = req;
    const {
      slowMovingDays = 30,
      deadStockDays = 60,
      obsoleteDays = 90,
      minStockValue = 0,
    } = req.body;

    const config = {
      slowMovingDays,
      deadStockDays,
      obsoleteDays,
      minStockValue,
    };

    // Run dead stock analysis
    const analysisResults = await DeadStockAnalysis.analyzeDeadStock(
      user.storeId,
      config
    );

    // Save analysis results to database
    const savedResults = [];
    for (const result of analysisResults) {
      const saved = await DeadStockAnalysis.create(result);
      savedResults.push(saved);
    }

    res.json({
      success: true,
      message: `Analyzed ${analysisResults.length} products`,
      results: savedResults,
    });
  } catch (error) {
    console.error("Error running dead stock analysis:", error);
    res.status(500).json({ error: "Failed to run dead stock analysis" });
  }
});

// Get dead stock trends
router.get("/dead-stock/trends", authenticateToken, async (req, res) => {
  try {
    const { user } = req;
    const { startDate, endDate } = req.query;

    const trends = await DeadStockAnalysis.getDeadStockTrends(
      user.storeId,
      startDate,
      endDate
    );

    res.json({ trends });
  } catch (error) {
    console.error("Error fetching dead stock trends:", error);
    res.status(500).json({ error: "Failed to fetch dead stock trends" });
  }
});

// Get liquidation impact analysis
router.get(
  "/dead-stock/liquidation-impact",
  authenticateToken,
  async (req, res) => {
    try {
      const { user } = req;
      const { analysisDate } = req.query;

      const impactAnalysis =
        await DeadStockAnalysis.getLiquidationImpactAnalysis(
          user.storeId,
          analysisDate
        );

      res.json({ impactAnalysis });
    } catch (error) {
      console.error("Error fetching liquidation impact analysis:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch liquidation impact analysis" });
    }
  }
);

// Get immediate liquidation candidates
router.get(
  "/dead-stock/immediate-liquidation",
  authenticateToken,
  async (req, res) => {
    try {
      const { user } = req;
      const { priorityThreshold = 7, valueThreshold = 100 } = req.query;

      const candidates =
        await DeadStockAnalysis.getImmediateLiquidationCandidates(
          user.storeId,
          parseInt(priorityThreshold),
          parseFloat(valueThreshold)
        );

      res.json({ candidates });
    } catch (error) {
      console.error("Error fetching liquidation candidates:", error);
      res.status(500).json({ error: "Failed to fetch liquidation candidates" });
    }
  }
);

// Get dead stock summary statistics
router.get("/dead-stock/summary", authenticateToken, async (req, res) => {
  try {
    const { user } = req;
    const { analysisDate } = req.query;

    const summary = await DeadStockAnalysis.getSummaryStats(
      user.storeId,
      analysisDate
    );

    res.json({ summary });
  } catch (error) {
    console.error("Error fetching dead stock summary:", error);
    res.status(500).json({ error: "Failed to fetch dead stock summary" });
  }
});

// External factors endpoints
router.get("/external-factors", authenticateToken, async (req, res) => {
  try {
    const { user } = req;
    const { startDate, endDate, factorType } = req.query;

    const factors = await ExternalFactors.getFactorsForDateRange(
      startDate,
      endDate,
      user.storeId,
      factorType
    );

    res.json({ factors });
  } catch (error) {
    console.error("Error fetching external factors:", error);
    res.status(500).json({ error: "Failed to fetch external factors" });
  }
});

// Create external factor
router.post("/external-factors", authenticateToken, async (req, res) => {
  try {
    const { user } = req;
    const factorData = {
      ...req.body,
      storeId: user.storeId,
    };

    const factor = await ExternalFactors.create(factorData);

    res.status(201).json({ factor });
  } catch (error) {
    console.error("Error creating external factor:", error);
    res.status(500).json({ error: "Failed to create external factor" });
  }
});

// Create holiday factors for a year
router.post(
  "/external-factors/holidays",
  authenticateToken,
  async (req, res) => {
    try {
      const { user } = req;
      const { year } = req.body;

      const holidays = await ExternalFactors.createHolidayFactors(
        year,
        user.storeId
      );

      res.status(201).json({
        success: true,
        message: `Created ${holidays.length} holiday factors for ${year}`,
        holidays,
      });
    } catch (error) {
      console.error("Error creating holiday factors:", error);
      res.status(500).json({ error: "Failed to create holiday factors" });
    }
  }
);

// Get seasonal factors
router.get(
  "/external-factors/seasonal",
  authenticateToken,
  async (req, res) => {
    try {
      const { user } = req;
      const { category } = req.query;

      const seasonalFactors = await ExternalFactors.getSeasonalFactors(
        user.storeId,
        category
      );

      res.json({ seasonalFactors });
    } catch (error) {
      console.error("Error fetching seasonal factors:", error);
      res.status(500).json({ error: "Failed to fetch seasonal factors" });
    }
  }
);

module.exports = router;
