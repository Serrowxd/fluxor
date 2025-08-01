const express = require("express");
const router = express.Router();
const Analytics = require("../models/Analytics");
const { authenticateToken } = require("../middleware/auth");

// Middleware to ensure user is authenticated
router.use(authenticateToken);

// Get comprehensive dashboard analytics
router.get("/dashboard/:storeId", async (req, res) => {
  try {
    const { storeId } = req.params;
    const cacheKey = `dashboard_metrics_${storeId}`;

    // Try to get cached data first
    let metrics = await Analytics.getCachedAnalytics(cacheKey);

    if (!metrics) {
      // Calculate fresh metrics if not cached
      metrics = await Analytics.getDashboardMetrics(storeId);

      // Cache the results for 30 minutes
      await Analytics.cacheAnalytics(cacheKey, metrics, 30);
    }

    res.json({
      success: true,
      data: metrics,
      cached: !!metrics,
    });
  } catch (error) {
    console.error("Error fetching dashboard analytics:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch dashboard analytics",
    });
  }
});

// Get inventory turnover analysis
router.get("/turnover/:storeId", async (req, res) => {
  try {
    const { storeId } = req.params;
    const { period = "30 days", productId } = req.query;

    const cacheKey = `turnover_${storeId}_${period}_${productId || "all"}`;
    let turnoverData = await Analytics.getCachedAnalytics(cacheKey);

    if (!turnoverData) {
      turnoverData = await Analytics.calculateInventoryTurnover(
        storeId,
        period,
        productId
      );
      await Analytics.cacheAnalytics(cacheKey, turnoverData, 60);
    }

    res.json({
      success: true,
      data: turnoverData,
    });
  } catch (error) {
    console.error("Error calculating inventory turnover:", error);
    res.status(500).json({
      success: false,
      error: "Failed to calculate inventory turnover",
    });
  }
});

// Get stockout rate analysis
router.get("/stockout/:storeId", async (req, res) => {
  try {
    const { storeId } = req.params;
    const { period = "30 days" } = req.query;

    const cacheKey = `stockout_${storeId}_${period}`;
    let stockoutData = await Analytics.getCachedAnalytics(cacheKey);

    if (!stockoutData) {
      stockoutData = await Analytics.calculateStockoutRate(storeId, period);
      await Analytics.cacheAnalytics(cacheKey, stockoutData, 60);
    }

    res.json({
      success: true,
      data: stockoutData,
    });
  } catch (error) {
    console.error("Error calculating stockout rate:", error);
    res.status(500).json({
      success: false,
      error: "Failed to calculate stockout rate",
    });
  }
});

// Get carrying cost analysis
router.get("/carrying-costs/:storeId", async (req, res) => {
  try {
    const { storeId } = req.params;
    const { productId } = req.query;

    const cacheKey = `carrying_costs_${storeId}_${productId || "all"}`;
    let carryingCostData = await Analytics.getCachedAnalytics(cacheKey);

    if (!carryingCostData) {
      carryingCostData = await Analytics.calculateCarryingCosts(
        storeId,
        productId
      );
      await Analytics.cacheAnalytics(cacheKey, carryingCostData, 120); // Cache for 2 hours
    }

    res.json({
      success: true,
      data: carryingCostData,
    });
  } catch (error) {
    console.error("Error calculating carrying costs:", error);
    res.status(500).json({
      success: false,
      error: "Failed to calculate carrying costs",
    });
  }
});

// Get gross margin analysis
router.get("/margins/:storeId", async (req, res) => {
  try {
    const { storeId } = req.params;
    const { period = "30 days", productId } = req.query;

    const cacheKey = `margins_${storeId}_${period}_${productId || "all"}`;
    let marginData = await Analytics.getCachedAnalytics(cacheKey);

    if (!marginData) {
      marginData = await Analytics.calculateGrossMargins(
        storeId,
        period,
        productId
      );
      await Analytics.cacheAnalytics(cacheKey, marginData, 60);
    }

    res.json({
      success: true,
      data: marginData,
    });
  } catch (error) {
    console.error("Error calculating gross margins:", error);
    res.status(500).json({
      success: false,
      error: "Failed to calculate gross margins",
    });
  }
});

// Get stock level analytics with seasonal patterns
router.get("/stock-levels/:storeId", async (req, res) => {
  try {
    const { storeId } = req.params;
    const { period = "90 days" } = req.query;

    const cacheKey = `stock_levels_${storeId}_${period}`;
    let stockLevelData = await Analytics.getCachedAnalytics(cacheKey);

    if (!stockLevelData) {
      stockLevelData = await Analytics.getStockLevelAnalytics(storeId, period);
      await Analytics.cacheAnalytics(cacheKey, stockLevelData, 30);
    }

    res.json({
      success: true,
      data: stockLevelData,
    });
  } catch (error) {
    console.error("Error getting stock level analytics:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get stock level analytics",
    });
  }
});

// Refresh analytics cache
router.post("/refresh-cache/:storeId", async (req, res) => {
  try {
    const { storeId } = req.params;

    // Clear all cached data for this store
    const cacheKeys = [
      `dashboard_metrics_${storeId}`,
      `turnover_${storeId}_*`,
      `stockout_${storeId}_*`,
      `carrying_costs_${storeId}_*`,
      `margins_${storeId}_*`,
      `stock_levels_${storeId}_*`,
    ];

    // Clear expired cache entries
    await Analytics.clearExpiredCache();

    // Recalculate dashboard metrics
    const metrics = await Analytics.getDashboardMetrics(storeId);
    await Analytics.cacheAnalytics(`dashboard_metrics_${storeId}`, metrics, 30);

    res.json({
      success: true,
      message: "Analytics cache refreshed successfully",
      data: metrics,
    });
  } catch (error) {
    console.error("Error refreshing analytics cache:", error);
    res.status(500).json({
      success: false,
      error: "Failed to refresh analytics cache",
    });
  }
});

// Get analytics benchmarks and industry standards
router.get("/benchmarks/:storeId", async (req, res) => {
  try {
    const { storeId } = req.params;

    // Industry benchmarks (these could be loaded from a config file or database)
    const benchmarks = {
      inventoryTurnover: {
        excellent: { min: 6, color: "green" },
        good: { min: 4, max: 6, color: "yellow" },
        fair: { min: 2, max: 4, color: "orange" },
        poor: { max: 2, color: "red" },
      },
      stockoutRate: {
        excellent: { max: 2, color: "green" },
        good: { min: 2, max: 5, color: "yellow" },
        fair: { min: 5, max: 10, color: "orange" },
        poor: { min: 10, color: "red" },
      },
      grossMargin: {
        excellent: { min: 40, color: "green" },
        good: { min: 25, max: 40, color: "yellow" },
        fair: { min: 15, max: 25, color: "orange" },
        poor: { max: 15, color: "red" },
      },
      carryingCost: {
        excellent: { max: 15, color: "green" },
        good: { min: 15, max: 25, color: "yellow" },
        fair: { min: 25, max: 35, color: "orange" },
        poor: { min: 35, color: "red" },
      },
    };

    res.json({
      success: true,
      data: benchmarks,
    });
  } catch (error) {
    console.error("Error fetching benchmarks:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch benchmarks",
    });
  }
});

module.exports = router;
