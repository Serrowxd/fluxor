const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const validation = require("../middleware/validation");
const { body, query, param } = require("express-validator");

const SupplierManagementService = require("../services/SupplierManagementService");
const PurchaseOrderService = require("../services/PurchaseOrderService");
const ReorderPointEngine = require("../services/ReorderPointEngine");
const ApprovalWorkflowEngine = require("../services/ApprovalWorkflowEngine");
const SupplierCommunicationService = require("../services/SupplierCommunicationService");

const supplierService = new SupplierManagementService();
const purchaseOrderService = new PurchaseOrderService();
const reorderEngine = new ReorderPointEngine();
const approvalEngine = new ApprovalWorkflowEngine();
const communicationService = new SupplierCommunicationService();

// Middleware to extract store_id from user context
const extractStoreId = async (req, res, next) => {
  try {
    // In a real implementation, you would get the store_id from the user's session/token
    // For now, we'll assume it's passed in the headers or use a default
    req.storeId = req.headers["x-store-id"] || req.user?.storeId;

    if (!req.storeId) {
      return res.status(400).json({ error: "Store ID is required" });
    }

    next();
  } catch (error) {
    res.status(500).json({ error: "Failed to extract store ID" });
  }
};

// === SUPPLIER MANAGEMENT ROUTES ===

/**
 * @route   GET /api/suppliers
 * @desc    Get all suppliers for a store
 * @access  Private
 */
router.get(
  "/",
  auth,
  extractStoreId,
  [
    query("is_active").optional().isBoolean(),
    query("preferred_supplier").optional().isBoolean(),
    query("search").optional().isString(),
    query("limit").optional().isInt({ min: 1, max: 100 }),
    query("offset").optional().isInt({ min: 0 }),
  ],
  validation,
  async (req, res) => {
    try {
      const filters = {
        is_active:
          req.query.is_active === "true"
            ? true
            : req.query.is_active === "false"
            ? false
            : undefined,
        preferred_supplier:
          req.query.preferred_supplier === "true"
            ? true
            : req.query.preferred_supplier === "false"
            ? false
            : undefined,
        search: req.query.search,
        limit: parseInt(req.query.limit) || 50,
        offset: parseInt(req.query.offset) || 0,
      };

      const suppliers = await supplierService.getSuppliers(
        req.storeId,
        filters
      );
      res.json(suppliers);
    } catch (error) {
      console.error("Error getting suppliers:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * @route   GET /api/suppliers/:id
 * @desc    Get supplier by ID
 * @access  Private
 */
router.get(
  "/:id",
  auth,
  extractStoreId,
  [param("id").isUUID()],
  validation,
  async (req, res) => {
    try {
      const supplier = await supplierService.getSupplierById(
        req.params.id,
        req.storeId
      );
      res.json(supplier);
    } catch (error) {
      console.error("Error getting supplier:", error);
      res.status(404).json({ error: error.message });
    }
  }
);

/**
 * @route   POST /api/suppliers
 * @desc    Create new supplier
 * @access  Private
 */
router.post(
  "/",
  auth,
  extractStoreId,
  [
    body("supplier_name").notEmpty().withMessage("Supplier name is required"),
    body("email").optional().isEmail(),
    body("phone").optional().isString(),
    body("address_line1").optional().isString(),
    body("city").optional().isString(),
    body("country").optional().isString(),
    body("payment_terms").optional().isString(),
    body("currency").optional().isLength({ min: 3, max: 3 }),
    body("preferred_supplier").optional().isBoolean(),
  ],
  validation,
  async (req, res) => {
    try {
      const supplier = await supplierService.createSupplier(
        req.storeId,
        req.body
      );
      res.status(201).json(supplier);
    } catch (error) {
      console.error("Error creating supplier:", error);
      res.status(400).json({ error: error.message });
    }
  }
);

/**
 * @route   PUT /api/suppliers/:id
 * @desc    Update supplier
 * @access  Private
 */
router.put(
  "/:id",
  auth,
  extractStoreId,
  [
    param("id").isUUID(),
    body("supplier_name").optional().notEmpty(),
    body("email").optional().isEmail(),
    body("phone").optional().isString(),
    body("is_active").optional().isBoolean(),
    body("preferred_supplier").optional().isBoolean(),
  ],
  validation,
  async (req, res) => {
    try {
      const supplier = await supplierService.updateSupplier(
        req.params.id,
        req.storeId,
        req.body
      );
      res.json(supplier);
    } catch (error) {
      console.error("Error updating supplier:", error);
      res.status(400).json({ error: error.message });
    }
  }
);

/**
 * @route   DELETE /api/suppliers/:id
 * @desc    Delete/deactivate supplier
 * @access  Private
 */
router.delete(
  "/:id",
  auth,
  extractStoreId,
  [param("id").isUUID(), query("hard_delete").optional().isBoolean()],
  validation,
  async (req, res) => {
    try {
      const hardDelete = req.query.hard_delete === "true";
      const success = await supplierService.deleteSupplier(
        req.params.id,
        req.storeId,
        hardDelete
      );

      if (success) {
        res.json({
          message: hardDelete
            ? "Supplier deleted successfully"
            : "Supplier deactivated successfully",
        });
      } else {
        res.status(404).json({ error: "Supplier not found" });
      }
    } catch (error) {
      console.error("Error deleting supplier:", error);
      res.status(400).json({ error: error.message });
    }
  }
);

// === SUPPLIER-PRODUCT MAPPING ROUTES ===

/**
 * @route   GET /api/suppliers/products/mappings
 * @desc    Get product-supplier mappings
 * @access  Private
 */
router.get(
  "/products/mappings",
  auth,
  extractStoreId,
  [
    query("supplier_id").optional().isUUID(),
    query("product_id").optional().isUUID(),
    query("is_primary_supplier").optional().isBoolean(),
  ],
  validation,
  async (req, res) => {
    try {
      const filters = {
        supplier_id: req.query.supplier_id,
        product_id: req.query.product_id,
        store_id: req.storeId,
        is_primary_supplier:
          req.query.is_primary_supplier === "true"
            ? true
            : req.query.is_primary_supplier === "false"
            ? false
            : undefined,
      };

      const mappings = await supplierService.getProductSupplierMappings(
        filters
      );
      res.json(mappings);
    } catch (error) {
      console.error("Error getting product-supplier mappings:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * @route   POST /api/suppliers/products/mappings
 * @desc    Add product-supplier mapping
 * @access  Private
 */
router.post(
  "/products/mappings",
  auth,
  extractStoreId,
  [
    body("supplier_id").isUUID(),
    body("product_id").isUUID(),
    body("lead_time_days").isInt({ min: 1 }),
    body("minimum_order_quantity").isInt({ min: 1 }),
    body("cost_per_unit").isFloat({ min: 0 }),
    body("is_primary_supplier").optional().isBoolean(),
  ],
  validation,
  async (req, res) => {
    try {
      const mapping = await supplierService.addProductSupplierMapping(req.body);
      res.status(201).json(mapping);
    } catch (error) {
      console.error("Error adding product-supplier mapping:", error);
      res.status(400).json({ error: error.message });
    }
  }
);

/**
 * @route   PUT /api/suppliers/products/mappings/:id
 * @desc    Update product-supplier mapping
 * @access  Private
 */
router.put(
  "/products/mappings/:id",
  auth,
  extractStoreId,
  [
    param("id").isUUID(),
    body("lead_time_days").optional().isInt({ min: 1 }),
    body("cost_per_unit").optional().isFloat({ min: 0 }),
    body("is_primary_supplier").optional().isBoolean(),
  ],
  validation,
  async (req, res) => {
    try {
      const mapping = await supplierService.updateProductSupplierMapping(
        req.params.id,
        req.body
      );
      res.json(mapping);
    } catch (error) {
      console.error("Error updating product-supplier mapping:", error);
      res.status(400).json({ error: error.message });
    }
  }
);

// === SUPPLIER PERFORMANCE ROUTES ===

/**
 * @route   POST /api/suppliers/:id/performance
 * @desc    Record supplier performance metric
 * @access  Private
 */
router.post(
  "/:id/performance",
  auth,
  extractStoreId,
  [
    param("id").isUUID(),
    body("metric_type").isIn(["delivery_time", "quality", "communication"]),
    body("metric_value").isFloat(),
    body("metric_unit").isString(),
    body("measurement_date").isISO8601(),
    body("po_id").optional().isUUID(),
  ],
  validation,
  async (req, res) => {
    try {
      const performanceData = {
        supplier_id: req.params.id,
        ...req.body,
      };

      const performance = await supplierService.recordSupplierPerformance(
        performanceData
      );
      res.status(201).json(performance);
    } catch (error) {
      console.error("Error recording supplier performance:", error);
      res.status(400).json({ error: error.message });
    }
  }
);

/**
 * @route   GET /api/suppliers/:id/performance
 * @desc    Get supplier performance analytics
 * @access  Private
 */
router.get(
  "/:id/performance",
  auth,
  extractStoreId,
  [
    param("id").isUUID(),
    query("start_date").optional().isISO8601(),
    query("end_date").optional().isISO8601(),
    query("metric_types").optional().isString(),
  ],
  validation,
  async (req, res) => {
    try {
      const filters = {
        startDate: req.query.start_date,
        endDate: req.query.end_date,
        metricTypes: req.query.metric_types
          ? req.query.metric_types.split(",")
          : undefined,
      };

      const analytics = await supplierService.getSupplierPerformanceAnalytics(
        req.params.id,
        filters
      );
      res.json(analytics);
    } catch (error) {
      console.error("Error getting supplier performance analytics:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// === PREFERRED SUPPLIERS ROUTES ===

/**
 * @route   GET /api/suppliers/preferred/:productId
 * @desc    Get preferred suppliers for a product
 * @access  Private
 */
router.get(
  "/preferred/:productId",
  auth,
  extractStoreId,
  [
    param("productId").isUUID(),
    query("limit").optional().isInt({ min: 1, max: 10 }),
  ],
  validation,
  async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 3;
      const suppliers = await supplierService.getPreferredSuppliersForProduct(
        req.params.productId,
        limit
      );
      res.json(suppliers);
    } catch (error) {
      console.error("Error getting preferred suppliers:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// === BULK PRICING ROUTES ===

/**
 * @route   POST /api/suppliers/products/pricing/calculate
 * @desc    Calculate bulk pricing for a quantity
 * @access  Private
 */
router.post(
  "/products/pricing/calculate",
  auth,
  extractStoreId,
  [body("supplier_product_id").isUUID(), body("quantity").isInt({ min: 1 })],
  validation,
  async (req, res) => {
    try {
      const { supplier_product_id, quantity } = req.body;
      const pricing = await supplierService.calculateBulkPricing(
        supplier_product_id,
        quantity
      );
      res.json(pricing);
    } catch (error) {
      console.error("Error calculating bulk pricing:", error);
      res.status(400).json({ error: error.message });
    }
  }
);

// === SUPPLIER COMMUNICATION ROUTES ===

/**
 * @route   GET /api/suppliers/:id/communications
 * @desc    Get communication history for a supplier
 * @access  Private
 */
router.get(
  "/:id/communications",
  auth,
  extractStoreId,
  [
    param("id").isUUID(),
    query("communication_type")
      .optional()
      .isIn(["email", "phone", "edi", "portal"]),
    query("direction").optional().isIn(["inbound", "outbound"]),
    query("limit").optional().isInt({ min: 1, max: 100 }),
  ],
  validation,
  async (req, res) => {
    try {
      const filters = {
        supplier_id: req.params.id,
        communication_type: req.query.communication_type,
        direction: req.query.direction,
        limit: parseInt(req.query.limit) || 50,
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

module.exports = router;
