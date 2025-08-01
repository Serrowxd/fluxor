const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const validation = require("../middleware/validation");
const { body, query, param } = require("express-validator");

const PurchaseOrderService = require("../services/PurchaseOrderService");
const ReorderPointEngine = require("../services/ReorderPointEngine");
const ApprovalWorkflowEngine = require("../services/ApprovalWorkflowEngine");
const SupplierCommunicationService = require("../services/SupplierCommunicationService");

const purchaseOrderService = new PurchaseOrderService();
const reorderEngine = new ReorderPointEngine();
const approvalEngine = new ApprovalWorkflowEngine();
const communicationService = new SupplierCommunicationService();

// Middleware to extract store_id and user_id from context
const extractUserContext = async (req, res, next) => {
  try {
    req.storeId = req.headers["x-store-id"] || req.user?.storeId;
    req.userId = req.user?.user_id || req.user?.id;

    if (!req.storeId) {
      return res.status(400).json({ error: "Store ID is required" });
    }

    if (!req.userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    next();
  } catch (error) {
    res.status(500).json({ error: "Failed to extract user context" });
  }
};

// === PURCHASE ORDER MANAGEMENT ROUTES ===

/**
 * @route   GET /api/purchase-orders
 * @desc    Get purchase orders with filtering
 * @access  Private
 */
router.get(
  "/",
  auth,
  extractUserContext,
  [
    query("status")
      .optional()
      .isIn([
        "draft",
        "submitted",
        "approved",
        "rejected",
        "received",
        "cancelled",
        "partially_received",
      ]),
    query("supplier_id").optional().isUUID(),
    query("start_date").optional().isISO8601(),
    query("end_date").optional().isISO8601(),
    query("search").optional().isString(),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("offset").optional().isInt({ min: 0 }),
  ],
  validation,
  async (req, res) => {
    try {
      const filters = {
        status: req.query.status ? req.query.status.split(",") : undefined,
        supplier_id: req.query.supplier_id,
        start_date: req.query.start_date,
        end_date: req.query.end_date,
        search: req.query.search,
        limit: parseInt(req.query.limit) || 50,
        offset: parseInt(req.query.offset) || 0,
      };

      const purchaseOrders = await purchaseOrderService.getPurchaseOrders(
        req.storeId,
        filters
      );
      res.json(purchaseOrders);
    } catch (error) {
      console.error("Error getting purchase orders:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * @route   GET /api/purchase-orders/:id
 * @desc    Get purchase order by ID with full details
 * @access  Private
 */
router.get(
  "/:id",
  auth,
  extractUserContext,
  [param("id").isUUID()],
  validation,
  async (req, res) => {
    try {
      const purchaseOrder = await purchaseOrderService.getPurchaseOrderById(
        req.params.id,
        req.storeId
      );
      res.json(purchaseOrder);
    } catch (error) {
      console.error("Error getting purchase order:", error);
      res.status(404).json({ error: error.message });
    }
  }
);

/**
 * @route   POST /api/purchase-orders
 * @desc    Create new purchase order
 * @access  Private
 */
router.post(
  "/",
  auth,
  extractUserContext,
  [
    body("supplier_id").isUUID(),
    body("items").isArray({ min: 1 }),
    body("items.*.product_id").isUUID(),
    body("items.*.supplier_product_id").optional().isUUID(),
    body("items.*.quantity").isInt({ min: 1 }),
    body("expected_delivery_date").optional().isISO8601(),
    body("payment_terms").optional().isString(),
    body("notes").optional().isString(),
  ],
  validation,
  async (req, res) => {
    try {
      const purchaseOrder = await purchaseOrderService.createPurchaseOrder(
        req.storeId,
        req.userId,
        req.body
      );

      res.status(201).json(purchaseOrder);
    } catch (error) {
      console.error("Error creating purchase order:", error);
      res.status(400).json({ error: error.message });
    }
  }
);

/**
 * @route   PUT /api/purchase-orders/:id/status
 * @desc    Update purchase order status
 * @access  Private
 */
router.put(
  "/:id/status",
  auth,
  extractUserContext,
  [
    param("id").isUUID(),
    body("status").isIn([
      "draft",
      "submitted",
      "approved",
      "rejected",
      "received",
      "cancelled",
    ]),
    body("notes").optional().isString(),
    body("cancellation_reason").optional().isString(),
    body("actual_delivery_date").optional().isISO8601(),
  ],
  validation,
  async (req, res) => {
    try {
      const { status, ...additionalData } = req.body;

      const updatedPO = await purchaseOrderService.updatePurchaseOrderStatus(
        req.params.id,
        req.storeId,
        status,
        req.userId,
        additionalData
      );

      res.json(updatedPO);
    } catch (error) {
      console.error("Error updating purchase order status:", error);
      res.status(400).json({ error: error.message });
    }
  }
);

/**
 * @route   PUT /api/purchase-orders/:id/cancel
 * @desc    Cancel a purchase order
 * @access  Private
 */
router.put(
  "/:id/cancel",
  auth,
  extractUserContext,
  [
    param("id").isUUID(),
    body("reason").notEmpty().withMessage("Cancellation reason is required"),
  ],
  validation,
  async (req, res) => {
    try {
      const cancelledPO = await purchaseOrderService.cancelPurchaseOrder(
        req.params.id,
        req.storeId,
        req.userId,
        req.body.reason
      );

      res.json(cancelledPO);
    } catch (error) {
      console.error("Error cancelling purchase order:", error);
      res.status(400).json({ error: error.message });
    }
  }
);

/**
 * @route   POST /api/purchase-orders/:id/receive
 * @desc    Receive items for a purchase order
 * @access  Private
 */
router.post(
  "/:id/receive",
  auth,
  extractUserContext,
  [
    param("id").isUUID(),
    body("received_items").isArray({ min: 1 }),
    body("received_items.*.po_item_id").isUUID(),
    body("received_items.*.quantity_received").isInt({ min: 1 }),
    body("received_items.*.actual_delivery_date").optional().isISO8601(),
    body("received_items.*.notes").optional().isString(),
  ],
  validation,
  async (req, res) => {
    try {
      const receiptSummary = await purchaseOrderService.receiveItems(
        req.params.id,
        req.storeId,
        req.body.received_items,
        req.userId
      );

      res.json(receiptSummary);
    } catch (error) {
      console.error("Error receiving items:", error);
      res.status(400).json({ error: error.message });
    }
  }
);

// === AUTOMATED PURCHASE ORDER GENERATION ===

/**
 * @route   POST /api/purchase-orders/generate/automatic
 * @desc    Generate automatic purchase orders based on reorder rules
 * @access  Private
 */
router.post(
  "/generate/automatic",
  auth,
  extractUserContext,
  [
    body("dry_run").optional().isBoolean(),
    body("supplier_id").optional().isUUID(),
    body("product_ids").optional().isArray(),
    body("max_pos_per_supplier").optional().isInt({ min: 1, max: 20 }),
  ],
  validation,
  async (req, res) => {
    try {
      const options = {
        dryRun: req.body.dry_run || false,
        supplierId: req.body.supplier_id,
        productIds: req.body.product_ids,
        maxPOsPerSupplier: req.body.max_pos_per_supplier || 5,
      };

      const result = await purchaseOrderService.generateAutomaticPurchaseOrders(
        req.storeId,
        options
      );
      res.json(result);
    } catch (error) {
      console.error("Error generating automatic purchase orders:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// === PURCHASE ORDER ANALYTICS ===

/**
 * @route   GET /api/purchase-orders/analytics
 * @desc    Get purchase order analytics
 * @access  Private
 */
router.get(
  "/analytics",
  auth,
  extractUserContext,
  [
    query("start_date").optional().isISO8601(),
    query("end_date").optional().isISO8601(),
  ],
  validation,
  async (req, res) => {
    try {
      const filters = {
        startDate: req.query.start_date,
        endDate: req.query.end_date,
      };

      const analytics = await purchaseOrderService.getPurchaseOrderAnalytics(
        req.storeId,
        filters
      );
      res.json(analytics);
    } catch (error) {
      console.error("Error getting purchase order analytics:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// === PURCHASE ORDER COMMUNICATION ===

/**
 * @route   POST /api/purchase-orders/:id/send-email
 * @desc    Send purchase order to supplier via email
 * @access  Private
 */
router.post(
  "/:id/send-email",
  auth,
  extractUserContext,
  [
    param("id").isUUID(),
    body("include_attachment").optional().isBoolean(),
    body("custom_message").optional().isString(),
    body("urgent_delivery").optional().isBoolean(),
  ],
  validation,
  async (req, res) => {
    try {
      const options = {
        includeAttachment: req.body.include_attachment !== false,
        customMessage: req.body.custom_message || "",
        urgentDelivery: req.body.urgent_delivery || false,
      };

      const result = await communicationService.sendPurchaseOrderEmail(
        req.params.id,
        options
      );
      res.json(result);
    } catch (error) {
      console.error("Error sending purchase order email:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * @route   GET /api/purchase-orders/:id/communications
 * @desc    Get communication history for a purchase order
 * @access  Private
 */
router.get(
  "/:id/communications",
  auth,
  extractUserContext,
  [
    param("id").isUUID(),
    query("communication_type")
      .optional()
      .isIn(["email", "phone", "edi", "portal"]),
  ],
  validation,
  async (req, res) => {
    try {
      const filters = {
        po_id: req.params.id,
        communication_type: req.query.communication_type,
      };

      const communications = await communicationService.getCommunicationHistory(
        filters
      );
      res.json(communications);
    } catch (error) {
      console.error("Error getting communication history:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// === APPROVAL WORKFLOW ROUTES ===

/**
 * @route   GET /api/purchase-orders/:id/approvals
 * @desc    Get approval history for a purchase order
 * @access  Private
 */
router.get(
  "/:id/approvals",
  auth,
  extractUserContext,
  [param("id").isUUID()],
  validation,
  async (req, res) => {
    try {
      const approvals = await approvalEngine.getApprovalHistory(
        req.params.id,
        req.storeId
      );
      res.json(approvals);
    } catch (error) {
      console.error("Error getting approval history:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * @route   POST /api/purchase-orders/:id/start-approval
 * @desc    Start approval process for a purchase order
 * @access  Private
 */
router.post(
  "/:id/start-approval",
  auth,
  extractUserContext,
  [param("id").isUUID()],
  validation,
  async (req, res) => {
    try {
      // Get PO data for workflow evaluation
      const purchaseOrder = await purchaseOrderService.getPurchaseOrderById(
        req.params.id,
        req.storeId
      );

      const approvalProcess = await approvalEngine.startApprovalProcess(
        req.params.id,
        req.storeId,
        {
          total_amount: purchaseOrder.total_amount,
          supplier_id: purchaseOrder.supplier_id,
          created_by: purchaseOrder.created_by,
        }
      );

      res.json(approvalProcess);
    } catch (error) {
      console.error("Error starting approval process:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// === REORDER POINT MANAGEMENT ===

/**
 * @route   GET /api/purchase-orders/reorder/rules
 * @desc    Get reorder rules
 * @access  Private
 */
router.get(
  "/reorder/rules",
  auth,
  extractUserContext,
  [
    query("product_id").optional().isUUID(),
    query("supplier_id").optional().isUUID(),
    query("auto_reorder_enabled").optional().isBoolean(),
  ],
  validation,
  async (req, res) => {
    try {
      // This would require adding a method to get reorder rules
      // For now, return empty array
      res.json([]);
    } catch (error) {
      console.error("Error getting reorder rules:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * @route   POST /api/purchase-orders/reorder/calculate
 * @desc    Calculate optimal reorder point for a product
 * @access  Private
 */
router.post(
  "/reorder/calculate",
  auth,
  extractUserContext,
  [
    body("product_id").isUUID(),
    body("supplier_id").optional().isUUID(),
    body("service_level").optional().isFloat({ min: 0.1, max: 0.999 }),
    body("analysis_window").optional().isInt({ min: 30, max: 365 }),
  ],
  validation,
  async (req, res) => {
    try {
      const options = {
        supplierId: req.body.supplier_id,
        serviceLevel: req.body.service_level || 0.95,
        analysisWindow: req.body.analysis_window || 90,
      };

      const reorderAnalysis = await reorderEngine.calculateReorderPoint(
        req.body.product_id,
        options
      );
      res.json(reorderAnalysis);
    } catch (error) {
      console.error("Error calculating reorder point:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * @route   POST /api/purchase-orders/reorder/optimize
 * @desc    Optimize reorder points for multiple products
 * @access  Private
 */
router.post(
  "/reorder/optimize",
  auth,
  extractUserContext,
  [
    body("product_ids").optional().isArray(),
    body("supplier_id").optional().isUUID(),
    body("service_level").optional().isFloat({ min: 0.1, max: 0.999 }),
    body("update_rules").optional().isBoolean(),
  ],
  validation,
  async (req, res) => {
    try {
      const options = {
        productIds: req.body.product_ids,
        supplierId: req.body.supplier_id,
        serviceLevel: req.body.service_level || 0.95,
        updateRules: req.body.update_rules || false,
      };

      const optimizationResults = await reorderEngine.optimizeReorderPoints(
        req.storeId,
        options
      );
      res.json(optimizationResults);
    } catch (error) {
      console.error("Error optimizing reorder points:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * @route   POST /api/purchase-orders/reorder/apply-rule
 * @desc    Apply reorder rule to a product
 * @access  Private
 */
router.post(
  "/reorder/apply-rule",
  auth,
  extractUserContext,
  [
    body("product_id").isUUID(),
    body("supplier_id").isUUID(),
    body("reorder_point").isInt({ min: 0 }),
    body("reorder_quantity").isInt({ min: 1 }),
    body("safety_stock").optional().isInt({ min: 0 }),
    body("auto_reorder_enabled").optional().isBoolean(),
    body("seasonal_adjustment_factor")
      .optional()
      .isFloat({ min: 0.1, max: 5.0 }),
  ],
  validation,
  async (req, res) => {
    try {
      const rule = await reorderEngine.applyReorderRule(
        req.body.product_id,
        req.body.supplier_id,
        req.body
      );

      res.json(rule);
    } catch (error) {
      console.error("Error applying reorder rule:", error);
      res.status(400).json({ error: error.message });
    }
  }
);

module.exports = router;
