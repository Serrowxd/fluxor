const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const validation = require("../middleware/validation");
const { body, query, param } = require("express-validator");

const ApprovalWorkflowEngine = require("../services/ApprovalWorkflowEngine");

const approvalEngine = new ApprovalWorkflowEngine();

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

// === APPROVAL WORKFLOW MANAGEMENT ===

/**
 * @route   GET /api/approval-workflows
 * @desc    Get approval workflows for a store
 * @access  Private
 */
router.get(
  "/",
  auth,
  extractUserContext,
  [
    query("workflow_type")
      .optional()
      .isIn(["purchase_order", "expense", "adjustment"]),
    query("is_active").optional().isBoolean(),
  ],
  validation,
  async (req, res) => {
    try {
      const filters = {
        workflow_type: req.query.workflow_type,
        is_active:
          req.query.is_active === "true"
            ? true
            : req.query.is_active === "false"
            ? false
            : undefined,
      };

      const workflows = await approvalEngine.getWorkflows(req.storeId, filters);
      res.json(workflows);
    } catch (error) {
      console.error("Error getting approval workflows:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * @route   GET /api/approval-workflows/:id
 * @desc    Get approval workflow by ID with steps
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
      const workflow = await approvalEngine.getWorkflowById(
        req.params.id,
        req.storeId
      );
      res.json(workflow);
    } catch (error) {
      console.error("Error getting approval workflow:", error);
      res.status(404).json({ error: error.message });
    }
  }
);

/**
 * @route   POST /api/approval-workflows
 * @desc    Create new approval workflow
 * @access  Private
 */
router.post(
  "/",
  auth,
  extractUserContext,
  [
    body("workflow_name").notEmpty().withMessage("Workflow name is required"),
    body("description").optional().isString(),
    body("workflow_type").isIn(["purchase_order", "expense", "adjustment"]),
    body("trigger_conditions").isObject(),
    body("steps").isArray({ min: 1 }),
    body("steps.*.step_name").notEmpty(),
    body("steps.*.approver_user_id").optional().isUUID(),
    body("steps.*.approver_role").optional().isString(),
    body("steps.*.is_required").optional().isBoolean(),
    body("steps.*.timeout_hours").optional().isInt({ min: 1, max: 720 }),
  ],
  validation,
  async (req, res) => {
    try {
      const workflow = await approvalEngine.createWorkflow(
        req.storeId,
        req.body
      );
      res.status(201).json(workflow);
    } catch (error) {
      console.error("Error creating approval workflow:", error);
      res.status(400).json({ error: error.message });
    }
  }
);

/**
 * @route   PUT /api/approval-workflows/:id
 * @desc    Update approval workflow
 * @access  Private
 */
router.put(
  "/:id",
  auth,
  extractUserContext,
  [
    param("id").isUUID(),
    body("workflow_name").optional().notEmpty(),
    body("description").optional().isString(),
    body("trigger_conditions").optional().isObject(),
    body("is_active").optional().isBoolean(),
    body("steps").optional().isArray(),
  ],
  validation,
  async (req, res) => {
    try {
      const workflow = await approvalEngine.updateWorkflow(
        req.params.id,
        req.storeId,
        req.body
      );
      res.json(workflow);
    } catch (error) {
      console.error("Error updating approval workflow:", error);
      res.status(400).json({ error: error.message });
    }
  }
);

// === APPROVAL PROCESSING ===

/**
 * @route   GET /api/approval-workflows/pending/:userId
 * @desc    Get pending approvals for a user
 * @access  Private
 */
router.get(
  "/pending/:userId",
  auth,
  extractUserContext,
  [
    param("userId").isUUID(),
    query("workflow_type")
      .optional()
      .isIn(["purchase_order", "expense", "adjustment"]),
    query("urgent_only").optional().isBoolean(),
    query("limit").optional().isInt({ min: 1, max: 100 }),
  ],
  validation,
  async (req, res) => {
    try {
      // Verify user can access these approvals (either their own or if they're admin)
      if (req.params.userId !== req.userId && !req.user?.isAdmin) {
        return res
          .status(403)
          .json({ error: "Not authorized to view these approvals" });
      }

      const filters = {
        workflow_type: req.query.workflow_type,
        urgent_only: req.query.urgent_only === "true",
        limit: parseInt(req.query.limit) || 50,
      };

      const pendingApprovals = await approvalEngine.getPendingApprovalsForUser(
        req.params.userId,
        req.storeId,
        filters
      );

      res.json(pendingApprovals);
    } catch (error) {
      console.error("Error getting pending approvals:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * @route   POST /api/approval-workflows/approvals/:approvalId/process
 * @desc    Process an approval decision
 * @access  Private
 */
router.post(
  "/approvals/:approvalId/process",
  auth,
  extractUserContext,
  [
    param("approvalId").isUUID(),
    body("decision").isIn(["approved", "rejected"]),
    body("comments").optional().isString(),
  ],
  validation,
  async (req, res) => {
    try {
      const { decision, comments = "" } = req.body;

      const result = await approvalEngine.processApprovalDecision(
        req.params.approvalId,
        req.userId,
        decision,
        comments
      );

      res.json(result);
    } catch (error) {
      console.error("Error processing approval decision:", error);
      res.status(400).json({ error: error.message });
    }
  }
);

// === ESCALATION MANAGEMENT ===

/**
 * @route   POST /api/approval-workflows/escalations/process
 * @desc    Process overdue approval escalations
 * @access  Private (Admin only)
 */
router.post(
  "/escalations/process",
  auth,
  extractUserContext,
  async (req, res) => {
    try {
      // Check if user has admin permissions
      if (!req.user?.isAdmin) {
        return res.status(403).json({ error: "Admin access required" });
      }

      const escalationSummary = await approvalEngine.processEscalations(
        req.storeId
      );
      res.json(escalationSummary);
    } catch (error) {
      console.error("Error processing escalations:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * @route   GET /api/approval-workflows/escalations
 * @desc    Get overdue approval escalations
 * @access  Private (Admin only)
 */
router.get("/escalations", auth, extractUserContext, async (req, res) => {
  try {
    // Check if user has admin permissions
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Admin access required" });
    }

    // Get overdue approvals without processing escalations
    const escalations = await approvalEngine.processEscalations(req.storeId);
    res.json(escalations);
  } catch (error) {
    console.error("Error getting escalations:", error);
    res.status(500).json({ error: error.message });
  }
});

// === WORKFLOW TESTING ===

/**
 * @route   POST /api/approval-workflows/:id/test
 * @desc    Test workflow trigger conditions
 * @access  Private
 */
router.post(
  "/:id/test",
  auth,
  extractUserContext,
  [param("id").isUUID(), body("test_data").isObject()],
  validation,
  async (req, res) => {
    try {
      const workflow = await approvalEngine.getWorkflowById(
        req.params.id,
        req.storeId
      );

      if (!workflow) {
        return res.status(404).json({ error: "Workflow not found" });
      }

      // Test if the workflow would be triggered by the test data
      const wouldTrigger = await approvalEngine.findApplicableWorkflow(
        req.storeId,
        workflow.workflow_type,
        req.body.test_data
      );

      res.json({
        workflow_id: workflow.workflow_id,
        workflow_name: workflow.workflow_name,
        would_trigger: wouldTrigger?.workflow_id === workflow.workflow_id,
        trigger_conditions: workflow.trigger_conditions,
        test_data: req.body.test_data,
      });
    } catch (error) {
      console.error("Error testing workflow:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// === APPROVAL ANALYTICS ===

/**
 * @route   GET /api/approval-workflows/analytics/summary
 * @desc    Get approval workflow analytics summary
 * @access  Private
 */
router.get(
  "/analytics/summary",
  auth,
  extractUserContext,
  [
    query("start_date").optional().isISO8601(),
    query("end_date").optional().isISO8601(),
    query("workflow_type")
      .optional()
      .isIn(["purchase_order", "expense", "adjustment"]),
  ],
  validation,
  async (req, res) => {
    try {
      // This would require implementing analytics methods in the ApprovalWorkflowEngine
      // For now, return a placeholder response
      res.json({
        message: "Approval analytics coming soon",
        filters: {
          start_date: req.query.start_date,
          end_date: req.query.end_date,
          workflow_type: req.query.workflow_type,
        },
      });
    } catch (error) {
      console.error("Error getting approval analytics:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

/**
 * @route   GET /api/approval-workflows/my-approvals
 * @desc    Get current user's pending approvals
 * @access  Private
 */
router.get(
  "/my-approvals",
  auth,
  extractUserContext,
  [
    query("workflow_type")
      .optional()
      .isIn(["purchase_order", "expense", "adjustment"]),
    query("urgent_only").optional().isBoolean(),
    query("limit").optional().isInt({ min: 1, max: 100 }),
  ],
  validation,
  async (req, res) => {
    try {
      const filters = {
        workflow_type: req.query.workflow_type,
        urgent_only: req.query.urgent_only === "true",
        limit: parseInt(req.query.limit) || 50,
      };

      const pendingApprovals = await approvalEngine.getPendingApprovalsForUser(
        req.userId,
        req.storeId,
        filters
      );

      res.json(pendingApprovals);
    } catch (error) {
      console.error("Error getting my approvals:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

module.exports = router;
