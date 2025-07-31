const DeadStockAnalysis = require("../models/DeadStockAnalysis");
const Product = require("../models/Product");
const Sale = require("../models/Sale");

class LiquidationRecommendationEngine {
  /**
   * Generate comprehensive liquidation strategy for a store
   */
  static async generateLiquidationStrategy(storeId, options = {}) {
    try {
      const defaultOptions = {
        timeframe: "immediate", // 'immediate', 'short_term', 'long_term'
        riskTolerance: "moderate", // 'conservative', 'moderate', 'aggressive'
        preferredChannels: ["in_store", "online", "wholesale"],
        maxDiscountThreshold: 70,
        minRecoveryTarget: 0.3, // 30% of original value
      };

      const config = { ...defaultOptions, ...options };

      // Get latest dead stock analysis
      const deadStockItems = await DeadStockAnalysis.getStoreDeadStockAnalysis(
        storeId
      );

      if (deadStockItems.length === 0) {
        return {
          strategy: "no_action_needed",
          message: "No dead stock items requiring liquidation",
          recommendations: [],
        };
      }

      // Group items by liquidation strategy
      const strategizedItems = await this.categorizeItemsByStrategy(
        deadStockItems,
        config
      );

      // Generate specific recommendations for each category
      const recommendations = await this.generateDetailedRecommendations(
        strategizedItems,
        config
      );

      // Calculate financial impact
      const financialImpact = this.calculateFinancialImpact(
        deadStockItems,
        recommendations
      );

      // Create implementation timeline
      const timeline = this.createImplementationTimeline(
        recommendations,
        config
      );

      return {
        strategy: "comprehensive_liquidation",
        totalItemsToLiquidate: deadStockItems.length,
        totalCurrentValue: deadStockItems.reduce(
          (sum, item) => sum + item.current_stock_value,
          0
        ),
        estimatedRecovery: financialImpact.totalEstimatedRecovery,
        recommendations,
        financialImpact,
        timeline,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error(
        `Error generating liquidation strategy for store ${storeId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Categorize items by optimal liquidation strategy
   */
  static async categorizeItemsByStrategy(deadStockItems, config) {
    const categories = {
      immediate_clearance: [],
      promotional_liquidation: [],
      bulk_wholesale: [],
      gradual_markdown: [],
      supplier_return: [],
      donation_writeoff: [],
    };

    for (const item of deadStockItems) {
      const strategy = await this.determineBestStrategy(item, config);
      categories[strategy].push({
        ...item,
        recommendedStrategy: strategy,
      });
    }

    return categories;
  }

  /**
   * Determine the best liquidation strategy for an item
   */
  static async determineBestStrategy(item, config) {
    const {
      dead_stock_classification,
      liquidation_priority,
      current_stock_value,
      days_without_sale,
    } = item;

    // Immediate clearance for high-priority obsolete items
    if (dead_stock_classification === "obsolete" && liquidation_priority >= 8) {
      return "immediate_clearance";
    }

    // Bulk wholesale for high-value items
    if (
      current_stock_value > 1000 &&
      dead_stock_classification !== "slow_moving"
    ) {
      return "bulk_wholesale";
    }

    // Supplier return for newer dead stock (if possible)
    if (days_without_sale < 120 && dead_stock_classification === "dead_stock") {
      // Check if supplier return is possible (this would need supplier data)
      const hasReturnPolicy = await this.checkSupplierReturnPolicy(
        item.product_id
      );
      if (hasReturnPolicy) {
        return "supplier_return";
      }
    }

    // Promotional liquidation for moderate-value items
    if (
      current_stock_value > 100 &&
      current_stock_value <= 1000 &&
      dead_stock_classification === "dead_stock"
    ) {
      return "promotional_liquidation";
    }

    // Gradual markdown for slow-moving items
    if (dead_stock_classification === "slow_moving") {
      return "gradual_markdown";
    }

    // Donation/writeoff for low-value obsolete items
    if (current_stock_value < 100 && dead_stock_classification === "obsolete") {
      return "donation_writeoff";
    }

    return "promotional_liquidation"; // Default strategy
  }

  /**
   * Generate detailed recommendations for each strategy category
   */
  static async generateDetailedRecommendations(strategizedItems, config) {
    const recommendations = [];

    // Immediate clearance recommendations
    if (strategizedItems.immediate_clearance.length > 0) {
      recommendations.push({
        strategy: "immediate_clearance",
        priority: "urgent",
        timeframe: "1-7 days",
        items: strategizedItems.immediate_clearance,
        actions: [
          {
            action: "flash_sale",
            discount: "50-70%",
            duration: "48-72 hours",
            channels: ["in_store", "email", "social_media"],
            expectedOutcome: "Clear 70-90% of inventory",
          },
          {
            action: "employee_sale",
            discount: "60%",
            duration: "24 hours",
            channels: ["internal"],
            expectedOutcome: "Staff purchase opportunity",
          },
        ],
        estimatedRecovery: this.calculateStrategyRecovery(
          strategizedItems.immediate_clearance,
          0.3
        ),
        implementation:
          "Mark down immediately, promote aggressively, clear space for new inventory",
      });
    }

    // Bulk wholesale recommendations
    if (strategizedItems.bulk_wholesale.length > 0) {
      recommendations.push({
        strategy: "bulk_wholesale",
        priority: "high",
        timeframe: "1-2 weeks",
        items: strategizedItems.bulk_wholesale,
        actions: [
          {
            action: "liquidator_contact",
            discount: "60-80%",
            duration: "negotiable",
            channels: ["wholesale_liquidators", "online_auctions"],
            expectedOutcome: "Bulk sale of high-value items",
          },
          {
            action: "competitor_outreach",
            discount: "40-60%",
            duration: "1 week",
            channels: ["direct_sales"],
            expectedOutcome: "B2B bulk sales",
          },
        ],
        estimatedRecovery: this.calculateStrategyRecovery(
          strategizedItems.bulk_wholesale,
          0.4
        ),
        implementation:
          "Group similar items, contact liquidation specialists, negotiate bulk pricing",
      });
    }

    // Promotional liquidation recommendations
    if (strategizedItems.promotional_liquidation.length > 0) {
      recommendations.push({
        strategy: "promotional_liquidation",
        priority: "medium",
        timeframe: "2-4 weeks",
        items: strategizedItems.promotional_liquidation,
        actions: [
          {
            action: "bundle_deals",
            discount: "25-40%",
            duration: "2 weeks",
            channels: ["in_store", "online"],
            expectedOutcome:
              "Increase transaction value while clearing inventory",
          },
          {
            action: "cross_promotion",
            discount: "30%",
            duration: "3 weeks",
            channels: ["in_store", "email"],
            expectedOutcome: "Pair with popular items to move dead stock",
          },
        ],
        estimatedRecovery: this.calculateStrategyRecovery(
          strategizedItems.promotional_liquidation,
          0.6
        ),
        implementation:
          "Create attractive bundles, cross-promote with bestsellers, gradual price reduction",
      });
    }

    // Gradual markdown recommendations
    if (strategizedItems.gradual_markdown.length > 0) {
      recommendations.push({
        strategy: "gradual_markdown",
        priority: "low",
        timeframe: "4-8 weeks",
        items: strategizedItems.gradual_markdown,
        actions: [
          {
            action: "weekly_markdowns",
            discount: "10-50% (gradual)",
            duration: "6 weeks",
            channels: ["in_store", "online"],
            expectedOutcome: "Test price sensitivity, maximize recovery",
          },
          {
            action: "seasonal_positioning",
            discount: "20-30%",
            duration: "4 weeks",
            channels: ["in_store"],
            expectedOutcome: "Position for seasonal relevance",
          },
        ],
        estimatedRecovery: this.calculateStrategyRecovery(
          strategizedItems.gradual_markdown,
          0.75
        ),
        implementation:
          "Start with small discounts, monitor response, increase gradually",
      });
    }

    // Supplier return recommendations
    if (strategizedItems.supplier_return.length > 0) {
      recommendations.push({
        strategy: "supplier_return",
        priority: "high",
        timeframe: "1-3 weeks",
        items: strategizedItems.supplier_return,
        actions: [
          {
            action: "return_negotiation",
            discount: "0-20% restocking fee",
            duration: "2 weeks",
            channels: ["supplier_direct"],
            expectedOutcome: "Return for credit or exchange",
          },
        ],
        estimatedRecovery: this.calculateStrategyRecovery(
          strategizedItems.supplier_return,
          0.8
        ),
        implementation:
          "Contact suppliers immediately, negotiate return terms, document agreements",
      });
    }

    // Donation writeoff recommendations
    if (strategizedItems.donation_writeoff.length > 0) {
      recommendations.push({
        strategy: "donation_writeoff",
        priority: "low",
        timeframe: "2-4 weeks",
        items: strategizedItems.donation_writeoff,
        actions: [
          {
            action: "charitable_donation",
            discount: "100% (tax benefit)",
            duration: "1 week",
            channels: ["local_charities"],
            expectedOutcome: "Tax deduction, community goodwill",
          },
          {
            action: "inventory_writeoff",
            discount: "100%",
            duration: "immediate",
            channels: ["accounting"],
            expectedOutcome: "Clean books, free storage space",
          },
        ],
        estimatedRecovery: this.calculateStrategyRecovery(
          strategizedItems.donation_writeoff,
          0.1
        ),
        implementation:
          "Partner with local charities, document donations for tax purposes",
      });
    }

    return recommendations;
  }

  /**
   * Calculate financial impact of liquidation strategies
   */
  static calculateFinancialImpact(deadStockItems, recommendations) {
    const currentTotalValue = deadStockItems.reduce(
      (sum, item) => sum + item.current_stock_value,
      0
    );
    const totalEstimatedRecovery = recommendations.reduce(
      (sum, rec) => sum + rec.estimatedRecovery,
      0
    );
    const totalPotentialLoss = currentTotalValue - totalEstimatedRecovery;

    // Calculate recovery by strategy
    const recoveryByStrategy = {};
    recommendations.forEach((rec) => {
      recoveryByStrategy[rec.strategy] = {
        itemCount: rec.items.length,
        currentValue: rec.items.reduce(
          (sum, item) => sum + item.current_stock_value,
          0
        ),
        estimatedRecovery: rec.estimatedRecovery,
        recoveryRate:
          rec.estimatedRecovery /
          rec.items.reduce((sum, item) => sum + item.current_stock_value, 0),
      };
    });

    // Calculate impact on cash flow
    const immediateRecovery = recommendations
      .filter(
        (rec) =>
          rec.timeframe.includes("days") || rec.timeframe.includes("1-2 weeks")
      )
      .reduce((sum, rec) => sum + rec.estimatedRecovery, 0);

    return {
      currentTotalValue,
      totalEstimatedRecovery,
      totalPotentialLoss,
      overallRecoveryRate: totalEstimatedRecovery / currentTotalValue,
      immediateRecovery,
      recoveryByStrategy,
      storageSpaceFreed: deadStockItems.length, // Approximate number of items
      improvementMetrics: {
        inventoryTurnoverImprovement:
          this.estimateInventoryTurnoverImprovement(deadStockItems),
        cashFlowImprovement: immediateRecovery,
        storageEfficiency: deadStockItems.length * 0.1, // Estimated storage cost per item
      },
    };
  }

  /**
   * Create implementation timeline
   */
  static createImplementationTimeline(recommendations, config) {
    const timeline = [];
    const currentDate = new Date();

    // Sort recommendations by priority and timeframe
    const sortedRecs = recommendations.sort((a, b) => {
      const priorityOrder = { urgent: 1, high: 2, medium: 3, low: 4 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    let dayOffset = 0;

    sortedRecs.forEach((rec) => {
      const startDate = new Date(currentDate);
      startDate.setDate(startDate.getDate() + dayOffset);

      const durationDays = this.parseTimeframeToDays(rec.timeframe);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + durationDays);

      timeline.push({
        strategy: rec.strategy,
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
        priority: rec.priority,
        itemCount: rec.items.length,
        estimatedRecovery: rec.estimatedRecovery,
        keyActions: rec.actions.map((action) => action.action),
        milestones: this.generateMilestones(rec, startDate, endDate),
      });

      // Stagger start dates for non-urgent items
      if (rec.priority !== "urgent") {
        dayOffset += Math.min(7, Math.floor(durationDays / 3));
      }
    });

    return timeline;
  }

  /**
   * Helper methods
   */
  static calculateStrategyRecovery(items, recoveryRate) {
    return items.reduce(
      (sum, item) => sum + item.current_stock_value * recoveryRate,
      0
    );
  }

  static async checkSupplierReturnPolicy(productId) {
    // This would check supplier agreements - simplified for now
    return Math.random() > 0.7; // 30% chance of return policy
  }

  static estimateInventoryTurnoverImprovement(deadStockItems) {
    // Simplified calculation - removing dead stock should improve turnover
    const deadStockValue = deadStockItems.reduce(
      (sum, item) => sum + item.current_stock_value,
      0
    );
    return deadStockValue * 0.05; // 5% improvement estimate
  }

  static parseTimeframeToDays(timeframe) {
    if (timeframe.includes("days")) {
      const match = timeframe.match(/(\d+)-?(\d+)?\s*days?/);
      return match ? parseInt(match[2] || match[1]) : 7;
    } else if (timeframe.includes("weeks")) {
      const match = timeframe.match(/(\d+)-?(\d+)?\s*weeks?/);
      return match ? parseInt(match[2] || match[1]) * 7 : 14;
    }
    return 14; // Default to 2 weeks
  }

  static generateMilestones(recommendation, startDate, endDate) {
    const milestones = [];
    const duration = (endDate - startDate) / (24 * 60 * 60 * 1000);

    if (duration >= 7) {
      const weeklyCheck = new Date(startDate);
      weeklyCheck.setDate(weeklyCheck.getDate() + 7);
      milestones.push({
        date: weeklyCheck.toISOString().split("T")[0],
        milestone: "Weekly progress review",
        target: "Assess strategy effectiveness",
      });
    }

    if (duration >= 14) {
      const midpoint = new Date(startDate);
      midpoint.setDate(midpoint.getDate() + Math.floor(duration / 2));
      milestones.push({
        date: midpoint.toISOString().split("T")[0],
        milestone: "Mid-strategy assessment",
        target: "Adjust tactics based on initial results",
      });
    }

    milestones.push({
      date: endDate.toISOString().split("T")[0],
      milestone: "Strategy completion",
      target: "Evaluate final results and lessons learned",
    });

    return milestones;
  }

  /**
   * Generate liquidation performance report
   */
  static async generatePerformanceReport(storeId, strategyId) {
    try {
      // This would track the actual performance of implemented strategies
      // For now, we'll create a template structure

      return {
        strategyId,
        storeId,
        reportDate: new Date().toISOString(),
        performance: {
          itemsLiquidated: 0,
          totalRecovery: 0,
          averageDiscountApplied: 0,
          timeToCompletion: 0,
        },
        lessonsLearned: [],
        recommendationsForFuture: [],
      };
    } catch (error) {
      console.error(
        `Error generating performance report for strategy ${strategyId}:`,
        error
      );
      throw error;
    }
  }
}

module.exports = LiquidationRecommendationEngine;
